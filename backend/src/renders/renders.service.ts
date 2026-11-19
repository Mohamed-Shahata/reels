import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type JobStatus as ProcessingJobStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProcessingJobsService } from '../processing/processing-jobs.service';
import { MediaAssetService } from '../storage/media-asset.service';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import {
  type SubtitleBurnIn,
  resolveSubtitleStyle,
  type SubtitleStyle,
} from '../subtitles/subtitle-style';
import {
  applySubtitleEdits,
  readStoredEdits,
  type SubtitleEdit,
} from '../subtitles/subtitle-edits';
import { SubtitlesService } from '../subtitles/subtitles.service';
import type { CreateClipRenderDto } from './dto/create-clip-render.dto';
import type { CreateRenderDto } from './dto/create-render.dto';

const REUSABLE_STATUSES: ProcessingJobStatus[] = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
];
const RENDER_HISTORY_LIMIT = 20;

const renderSelect = {
  id: true,
  clipId: true,
  startSec: true,
  endSec: true,
  outputUrl: true,
  subtitleStyle: true,
  subtitleEdits: true,
  createdAt: true,
  updatedAt: true,
  processingJob: {
    select: {
      status: true,
      progress: true,
      attempt: true,
      lastError: true,
    },
  },
} as const;

interface RenderRecord {
  id: string;
  clipId: string;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
  subtitleStyle: unknown;
  subtitleEdits?: unknown;
  createdAt: Date;
  updatedAt: Date;
  processingJob: {
    status: ProcessingJobStatus;
    progress: number;
    attempt: number;
    lastError: string | null;
  } | null;
}

export interface RenderView {
  id: string;
  clipId: string;
  status: ProcessingJobStatus;
  progress: number;
  attempts: number;
  error: string | null;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
  subtitles: boolean;
  subtitleStyle: SubtitleStyle | null;
  subtitleEdits: SubtitleEdit[];
  createdAt: Date;
  updatedAt: Date;
}

function toView(record: RenderRecord): RenderView {
  const job = record.processingJob;
  return {
    id: record.id,
    clipId: record.clipId,
    status: job?.status ?? 'QUEUED',
    progress: job?.progress ?? 0,
    attempts: job?.attempt ?? 0,
    error: job?.lastError ?? null,
    startSec: record.startSec,
    endSec: record.endSec,
    outputUrl: record.outputUrl,
    subtitles: record.subtitleStyle != null,
    subtitleStyle: (record.subtitleStyle as SubtitleStyle | null) ?? null,
    subtitleEdits: readStoredEdits(record.subtitleEdits),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

interface ClipToRender {
  id: string;
  startSec: number;
  endSec: number;
}

interface RenderContext {
  userId: string;
  videoId: string;
  transcriptId: string | null;
  subtitleStyle: SubtitleStyle | null;
  subtitleEdits: SubtitleEdit[];
}

interface PreparedBurnIn {
  burnIn: SubtitleBurnIn;
  edits: SubtitleEdit[];
}

// Raise when the way subtitles are drawn changes (padding, box opacity...), so
// finished reels made the old way are not reused for the same style and text.
const SUBTITLE_RENDER_VERSION = 3;

function computeSubtitleKey(burnIn: SubtitleBurnIn): string {
  return createHash('sha256')
    .update(JSON.stringify({ version: SUBTITLE_RENDER_VERSION, ...burnIn }))
    .digest('hex');
}

@Injectable()
export class RendersService {
  private readonly downloadTtlSec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: ProcessingJobsService,
    private readonly subtitles: SubtitlesService,
    private readonly mediaAssets?: MediaAssetService,
    config?: ConfigService<Env, true>,
  ) {
    this.downloadTtlSec =
      config?.get('DOWNLOAD_URL_TTL_SEC', { infer: true }) ?? 300;
  }

  async create(
    userId: string,
    clipId: string,
    dto: CreateClipRenderDto = {},
  ): Promise<RenderView> {
    const { subtitleEdits = [], regenerate = false, ...renderDto } = dto;
    if (subtitleEdits.length > 0 && !renderDto.subtitles) {
      throw new BadRequestException(
        'Subtitle edits can only be set when subtitles are enabled',
      );
    }

    const MAX_CONCURRENT_RENDERS = 2;
    const activeRendersCount =
      (await this.prisma.clipRender?.count?.({
        where: {
          clip: { video: { userId } },
          processingJob: {
            status: { in: ['QUEUED', 'RUNNING'] },
          },
        },
      })) ?? 0;
    if (activeRendersCount >= MAX_CONCURRENT_RENDERS) {
      throw new ConflictException(
        `Concurrent render limit reached (${MAX_CONCURRENT_RENDERS}). Please wait for active renders to finish.`,
      );
    }

    const subtitleStyle = this.resolveStyle(renderDto);
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: {
        id: true,
        startSec: true,
        endSec: true,
        video: {
          select: {
            id: true,
            status: true,
            transcript: { select: { id: true } },
          },
        },
      },
    });

    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    if (clip.video.status !== 'READY') {
      throw new ConflictException('Video is not ready for rendering');
    }

    if (regenerate) {
      await this.removeSubtitledRenders({ clipId: clip.id });
    }

    return this.queueRender(
      {
        userId,
        videoId: clip.video.id,
        transcriptId: clip.video.transcript?.id ?? null,
        subtitleStyle,
        subtitleEdits,
      },
      clip,
    );
  }

  /**
   * Deletes every finished or failed render with burned-in subtitles for a
   * video, or for one clip of it. Renders that are still running are kept so a
   * job in progress never loses its row. Called when the subtitle style or
   * text changes, because those renders no longer match what the user sees.
   */
  async deleteSubtitledRenders(
    userId: string,
    scope: { videoId: string } | { clipId: string },
  ): Promise<{ deleted: number }> {
    if ('clipId' in scope) {
      const clip = await this.prisma.clip.findFirst({
        where: { id: scope.clipId, video: { is: { userId } } },
        select: { id: true },
      });
      if (!clip) throw new NotFoundException('Clip was not found');
      return this.removeSubtitledRenders({ clipId: clip.id });
    }

    const video = await this.prisma.video.findFirst({
      where: { id: scope.videoId, userId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException('Video was not found');
    return this.removeSubtitledRenders({ videoId: video.id });
  }

  private async removeSubtitledRenders(
    scope: { videoId: string } | { clipId: string },
  ): Promise<{ deleted: number }> {
    const renders = await this.prisma.clipRender.findMany({
      where: {
        subtitleStyle: { not: Prisma.DbNull },
        ...('clipId' in scope
          ? { clipId: scope.clipId }
          : { clip: { is: { videoId: scope.videoId } } }),
        OR: [
          { processingJobId: null },
          {
            processingJob: { is: { status: { in: ['COMPLETED', 'FAILED'] } } },
          },
        ],
      },
      select: {
        id: true,
        assetId: true,
      },
    });
    if (renders.length === 0) return { deleted: 0 };

    for (const render of renders) {
      if (render.assetId && this.mediaAssets) {
        await this.mediaAssets.markDeleting(this.prisma, render.assetId);
      }
    }

    const { count } = await this.prisma.clipRender.deleteMany({
      where: { id: { in: renders.map((render) => render.id) } },
    });
    return { deleted: count };
  }

  /** Stops one render that is waiting or running. */
  async stop(userId: string, renderId: string): Promise<RenderView> {
    const render = await this.prisma.clipRender.findFirst({
      where: { id: renderId, clip: { is: { video: { is: { userId } } } } },
      select: {
        id: true,
        processingJobId: true,
        processingJob: { select: { status: true } },
      },
    });
    if (!render) throw new NotFoundException('Render was not found');

    const status = render.processingJob?.status;
    if (
      !render.processingJobId ||
      (status !== 'QUEUED' && status !== 'RUNNING')
    ) {
      throw new ConflictException('Only a render in progress can be stopped');
    }

    await this.jobs.cancelJob(render.processingJobId);
    const refreshed = await this.prisma.clipRender.findFirstOrThrow({
      where: { id: render.id },
      select: renderSelect,
    });
    return toView(refreshed);
  }

  /** Stops every render in progress for one clip. */
  async stopForClip(userId: string, clipId: string): Promise<RenderView[]> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: { id: true },
    });
    if (!clip) throw new NotFoundException('Clip was not found');
    return this.stopWhere({ clipId: clip.id });
  }

  /** Stops every render in progress for all clips of a video. */
  async stopForVideo(userId: string, videoId: string): Promise<RenderView[]> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true },
    });
    if (!video) throw new NotFoundException('Video was not found');
    return this.stopWhere({ clip: { is: { videoId: video.id } } });
  }

  private async stopWhere(
    scope: Prisma.ClipRenderWhereInput,
  ): Promise<RenderView[]> {
    const active = await this.prisma.clipRender.findMany({
      where: {
        ...scope,
        processingJob: { is: { status: { in: ['QUEUED', 'RUNNING'] } } },
      },
      select: { id: true, processingJobId: true },
    });

    const stopped: string[] = [];
    for (const render of active) {
      if (!render.processingJobId) continue;
      try {
        await this.jobs.cancelJob(render.processingJobId);
        stopped.push(render.id);
      } catch (error) {
        // It finished between the lookup and now; leave it as it is.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    if (stopped.length === 0) return [];

    const renders = await this.prisma.clipRender.findMany({
      where: { id: { in: stopped } },
      select: renderSelect,
    });
    return renders.map(toView);
  }

  async createForVideo(
    userId: string,
    videoId: string,
    dto: CreateRenderDto = {},
  ): Promise<RenderView[]> {
    const subtitleStyle = this.resolveStyle(dto);
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: {
        id: true,
        status: true,
        transcript: { select: { id: true } },
        clips: {
          orderBy: { startSec: 'asc' },
          select: { id: true, startSec: true, endSec: true },
        },
      },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    if (video.status !== 'READY') {
      throw new ConflictException('Video is not ready for rendering');
    }

    if (video.clips.length === 0) {
      throw new ConflictException('Video has no clips to render');
    }

    const context: RenderContext = {
      userId,
      videoId: video.id,
      transcriptId: video.transcript?.id ?? null,
      subtitleStyle,
      subtitleEdits: [],
    };
    const renders: RenderView[] = [];
    for (const clip of video.clips) {
      renders.push(await this.queueRender(context, clip));
    }
    return renders;
  }

  async listForVideo(userId: string, videoId: string): Promise<RenderView[]> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    const renders = await this.prisma.clipRender.findMany({
      where: { clip: { is: { videoId: video.id } } },
      orderBy: { createdAt: 'desc' },
      distinct: ['clipId', 'subtitleKey'],
      select: renderSelect,
    });
    return renders.map(toView);
  }

  async list(userId: string, clipId: string): Promise<RenderView[]> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: { id: true },
    });

    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    const renders = await this.prisma.clipRender.findMany({
      where: { clipId: clip.id },
      orderBy: { createdAt: 'desc' },
      take: RENDER_HISTORY_LIMIT,
      select: renderSelect,
    });
    return renders.map(toView);
  }

  async retry(userId: string, renderId: string): Promise<RenderView> {
    const render = await this.prisma.clipRender.findFirst({
      where: { id: renderId, clip: { is: { video: { is: { userId } } } } },
      select: {
        id: true,
        processingJobId: true,
        startSec: true,
        endSec: true,
        subtitleStyle: true,
        subtitleEdits: true,
        processingJob: { select: { status: true } },
        clip: {
          select: {
            startSec: true,
            endSec: true,
            video: { select: { transcript: { select: { id: true } } } },
          },
        },
      },
    });

    if (!render) {
      throw new NotFoundException('Render was not found');
    }

    if (!render.processingJobId || render.processingJob?.status !== 'FAILED') {
      throw new ConflictException('Only failed renders can be retried');
    }

    const refreshedBurnIn = await this.refreshBurnIn(render);

    await this.prisma.clipRender.update({
      where: { id: render.id },
      data: {
        startSec: render.clip.startSec,
        endSec: render.clip.endSec,
        outputUrl: null,
        ...refreshedBurnIn,
      },
    });
    await this.jobs.retryJob(render.processingJobId);

    const refreshed = await this.prisma.clipRender.findFirstOrThrow({
      where: { id: render.id },
      select: renderSelect,
    });
    return toView(refreshed);
  }

  async getDownloadUrl(userId: string, renderId: string): Promise<string> {
    const render = await this.prisma.clipRender.findFirst({
      where: { id: renderId, clip: { is: { video: { is: { userId } } } } },
      select: {
        id: true,
        assetId: true,
        outputUrl: true,
        startSec: true,
        endSec: true,
        subtitleStyle: true,
        subtitleCues: true,
        processingJob: { select: { status: true } },
        clip: {
          select: { id: true },
        },
      },
    });

    if (!render) {
      throw new NotFoundException('Render was not found');
    }

    if (
      render.processingJob?.status !== 'COMPLETED' &&
      !render.assetId &&
      !render.outputUrl
    ) {
      throw new ConflictException('Render is not ready to download');
    }

    if (render.assetId && this.mediaAssets) {
      return this.mediaAssets.signedUrl(render.assetId, this.downloadTtlSec);
    }

    if (render.outputUrl) {
      return render.outputUrl;
    }

    throw new ConflictException('Render is not ready to download');
  }

  private async refreshBurnIn(render: {
    startSec?: number;
    endSec?: number;
    subtitleStyle: unknown;
    subtitleEdits?: unknown;
    clip: {
      startSec: number;
      endSec: number;
      video: { transcript: { id: string } | null };
    };
  }): Promise<Record<string, unknown>> {
    if (render.subtitleStyle == null) return {};

    const transcriptId = render.clip.video.transcript?.id;
    if (!transcriptId) {
      throw new ConflictException(
        'Transcript must be ready before burning in subtitles',
      );
    }

    const hadEdits = render.subtitleEdits != null;
    const rangeUnchanged =
      render.startSec === render.clip.startSec &&
      render.endSec === render.clip.endSec;
    const storedEdits = rangeUnchanged
      ? readStoredEdits(render.subtitleEdits)
      : [];

    const prepared = await this.prepareBurnIn(
      render.subtitleStyle as SubtitleStyle,
      transcriptId,
      render.clip,
      storedEdits,
      { ignoreUnknownCues: true },
    );
    if (!prepared) return {};

    return {
      subtitleCues: prepared.burnIn.cues as unknown as Prisma.InputJsonValue,
      subtitleKey: computeSubtitleKey(prepared.burnIn),
      ...(hadEdits && {
        subtitleEdits:
          prepared.edits.length > 0 ? prepared.edits : Prisma.DbNull,
      }),
    };
  }

  private resolveStyle(dto: CreateRenderDto): SubtitleStyle | null {
    const { subtitles, preset, ...overrides } = dto;
    const hasStyleInput =
      preset !== undefined ||
      Object.values(overrides).some((value) => value !== undefined);

    if (!subtitles) {
      if (hasStyleInput) {
        throw new BadRequestException(
          'Subtitle style can only be set when subtitles are enabled',
        );
      }
      return null;
    }

    return resolveSubtitleStyle(preset, overrides).style;
  }

  private async prepareBurnIn(
    subtitleStyle: SubtitleStyle | null,
    transcriptId: string | null,
    range: { startSec: number; endSec: number },
    edits: readonly SubtitleEdit[] = [],
    editOptions: { ignoreUnknownCues?: boolean } = {},
  ): Promise<PreparedBurnIn | null> {
    if (!subtitleStyle) return null;

    if (!transcriptId) {
      throw new ConflictException(
        'Transcript must be ready before burning in subtitles',
      );
    }

    const generated = await this.subtitles.buildCues(
      transcriptId,
      range.startSec,
      range.endSec,
      subtitleStyle.displayMode,
    );
    const { cues, edits: appliedEdits } =
      edits.length > 0
        ? applySubtitleEdits(generated.cues, edits, editOptions)
        : { cues: generated.cues, edits: [] };

    return { burnIn: { style: subtitleStyle, cues }, edits: appliedEdits };
  }

  private async queueRender(
    context: RenderContext,
    clip: ClipToRender,
  ): Promise<RenderView> {
    const prepared = await this.prepareBurnIn(
      context.subtitleStyle,
      context.transcriptId,
      clip,
      context.subtitleEdits,
    );
    const burnIn = prepared?.burnIn ?? null;
    const subtitleKey = burnIn ? computeSubtitleKey(burnIn) : null;

    const existing = await this.prisma.clipRender.findFirst({
      where: {
        clipId: clip.id,
        startSec: clip.startSec,
        endSec: clip.endSec,
        subtitleKey,
        processingJob: { is: { status: { in: REUSABLE_STATUSES } } },
      },
      orderBy: { createdAt: 'desc' },
      select: renderSelect,
    });
    if (existing) {
      return toView(existing);
    }

    const render = await this.prisma.clipRender.create({
      data: {
        clipId: clip.id,
        startSec: clip.startSec,
        endSec: clip.endSec,
        ...(burnIn && {
          subtitleStyle: burnIn.style as unknown as Prisma.InputJsonValue,
          subtitleCues: burnIn.cues,
          subtitleKey,
          ...(prepared && prepared.edits.length > 0
            ? {
                subtitleEdits:
                  prepared.edits as unknown as Prisma.InputJsonValue,
              }
            : {}),
        }),
      },
      select: { id: true },
    });

    let job: { id: string };
    try {
      job = await this.jobs.createJob({
        userId: context.userId,
        videoId: context.videoId,
        type: 'RENDER',
        payload: { clipRenderId: render.id },
      });
    } catch (error) {
      await this.prisma.clipRender.delete({ where: { id: render.id } });
      throw error;
    }

    const linked = await this.prisma.clipRender.update({
      where: { id: render.id },
      data: { processingJobId: job.id },
      select: renderSelect,
    });
    return toView(linked);
  }
}
