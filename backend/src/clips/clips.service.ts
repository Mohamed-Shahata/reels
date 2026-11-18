import type { Response } from 'express';
import { tmpdir } from 'node:os';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { MediaAssetService } from '../storage/media-asset.service';
import { ProcessingJobsService } from '../processing/processing-jobs.service';
import { FfmpegRenderService } from '../renders/ffmpeg-render.service';
import type { ClipUrlOptions } from '../storage/storage.types';
import type { CreateClipDto } from './dto/create-clip.dto';
import type { UpdateClipDto } from './dto/update-clip.dto';
import type { SplitClipDto } from './dto/split-clip.dto';
import type { MergeClipsDto } from './dto/merge-clips.dto';
import type { ReconciledTopicSegment } from '../segmentation/boundary-reconciliation.service';
import { VideoLayout } from '../generated/prisma/client';

const clipSelect = {
  id: true,
  videoId: true,
  title: true,
  startSec: true,
  endSec: true,
  source: true,
  status: true,
  layout: true,
  score: true,
  reason: true,
  thumbnailUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

const clipWithVideoSelect = {
  id: true,
  videoId: true,
  startSec: true,
  endSec: true,
  video: { select: { id: true } },
} as const;

const aiRunSelect = {
  id: true,
  clipCount: true,
  replacedClipCount: true,
  segments: true,
  createdAt: true,
} as const;

const AI_RUN_HISTORY_LIMIT = 20;

export interface AiRunRecord {
  id: string;
  clipCount: number;
  replacedClipCount: number;
  segments: unknown;
  createdAt: Date;
}

export interface ClipRecord {
  id: string;
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
  source: 'MANUAL' | 'AI';
  status: 'DRAFT' | 'READY' | 'FAILED';
  layout: VideoLayout;
  score: number | null;
  reason: string | null;
  thumbnailUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);
  private readonly minDurationSec: number;
  private readonly maxDurationSec: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    private readonly jobsService?: ProcessingJobsService,
    private readonly mediaAssets?: MediaAssetService,
    private readonly ffmpegRender?: FfmpegRenderService,
  ) {
    this.minDurationSec = config.get('CLIP_MIN_DURATION_SEC', {
      infer: true,
    });
    this.maxDurationSec = config.get('CLIP_MAX_DURATION_SEC', {
      infer: true,
    });
  }

  async create(
    userId: string,
    videoId: string,
    dto: CreateClipDto,
  ): Promise<ClipRecord> {
    const video = await this.getReadyVideo(userId, videoId);
    this.validateRange(dto.startSec, dto.endSec, video.durationSec);

    const created = await this.prisma.clip.create({
      data: {
        videoId: video.id,
        title: dto.title,
        startSec: dto.startSec,
        endSec: dto.endSec,
      },
      select: clipSelect,
    });

    if (this.mediaAssets && this.ffmpegRender) {
      void this.generateClipThumbnail(
        userId,
        videoId,
        created.id,
        dto.startSec,
      );
      created.thumbnailUrl = `/api/v1/clips/${created.id}/thumbnail`;
    }

    await this.recordClipUsage(userId);
    return created;
  }

  async list(userId: string, videoId: string): Promise<ClipRecord[]> {
    await this.getOwnedVideo(userId, videoId);

    return this.prisma.clip.findMany({
      where: { videoId },
      orderBy: { startSec: 'asc' },
      select: clipSelect,
    });
  }

  async countAiClips(userId: string, videoId: string): Promise<number> {
    const video = await this.getReadyVideo(userId, videoId);

    return this.prisma.clip.count({
      where: { videoId: video.id, source: 'AI' },
    });
  }

  async listAiRuns(userId: string, videoId: string): Promise<AiRunRecord[]> {
    await this.getOwnedVideo(userId, videoId);

    return this.prisma.segmentationRun.findMany({
      where: { videoId, userId },
      orderBy: { createdAt: 'desc' },
      take: AI_RUN_HISTORY_LIMIT,
      select: aiRunSelect,
    });
  }

  async createAiSuggestions(
    userId: string,
    videoId: string,
    segments: ReconciledTopicSegment[],
    options: { replaceExisting?: boolean } = {},
  ): Promise<ClipRecord[]> {
    const video = await this.getReadyVideo(userId, videoId);
    if (segments.length === 0) {
      throw new BadRequestException('AI did not return any clip suggestions');
    }

    for (const segment of segments) {
      this.validateRange(segment.startSec, segment.endSec, video.durationSec);
    }

    return this.prisma.$transaction(async (transaction) => {
      const replaced = options.replaceExisting
        ? (
            await transaction.clip.deleteMany({
              where: { videoId: video.id, source: 'AI' },
            })
          ).count
        : 0;
      const clips = await transaction.clip.createManyAndReturn({
        data: segments.map((segment) => ({
          videoId: video.id,
          title: segment.title,
          startSec: segment.startSec,
          endSec: segment.endSec,
          source: 'AI' as const,
          status: 'DRAFT' as const,
          score: segment.score ?? null,
          reason: segment.reason ?? segment.summary ?? null,
        })),
        select: clipSelect,
      });

      await this.recordClipUsage(userId, segments.length, transaction);
      await transaction.segmentationRun.create({
        data: {
          userId,
          videoId: video.id,
          clipCount: clips.length,
          replacedClipCount: replaced,
          segments: segments.map(({ title, startSec, endSec, summary }) => ({
            title,
            startSec,
            endSec,
            summary,
          })),
        },
      });
      return clips.sort((left, right) => left.startSec - right.startSec);
    });
  }

  async update(
    userId: string,
    clipId: string,
    dto: UpdateClipDto,
  ): Promise<ClipRecord> {
    if (
      dto.title === undefined &&
      dto.startSec === undefined &&
      dto.endSec === undefined &&
      dto.layout === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one clip field to update',
      );
    }

    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: {
        id: true,
        title: true,
        startSec: true,
        endSec: true,
        video: { select: { id: true, status: true, durationSec: true } },
      },
    });

    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    this.ensureVideoReady(clip.video);
    const startSec = dto.startSec ?? clip.startSec;
    const endSec = dto.endSec ?? clip.endSec;
    this.validateRange(startSec, endSec, clip.video.durationSec);

    return this.prisma.clip.update({
      where: { id: clip.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.startSec !== undefined && { startSec: dto.startSec }),
        ...(dto.endSec !== undefined && { endSec: dto.endSec }),
        ...(dto.layout !== undefined && { layout: dto.layout }),
        source: 'MANUAL',
      },
      select: clipSelect,
    });
  }

  async split(
    userId: string,
    clipId: string,
    dto: SplitClipDto,
  ): Promise<ClipRecord[]> {
    const clip = await this.getOwnedEditableClip(userId, clipId);
    this.ensureVideoReady(clip.video);
    this.validateRange(clip.startSec, dto.splitSec, clip.video.durationSec);
    this.validateRange(dto.splitSec, clip.endSec, clip.video.durationSec);

    return this.prisma.$transaction(async (transaction) => {
      const first = await transaction.clip.update({
        where: { id: clip.id },
        data: {
          title: `${clip.title} (Part 1)`,
          endSec: dto.splitSec,
          source: 'MANUAL',
        },
        select: clipSelect,
      });
      const second = await transaction.clip.create({
        data: {
          videoId: clip.video.id,
          title: `${clip.title} (Part 2)`,
          startSec: dto.splitSec,
          endSec: clip.endSec,
          source: 'MANUAL',
        },
        select: clipSelect,
      });

      if (this.mediaAssets && this.ffmpegRender) {
        void this.generateClipThumbnail(
          userId,
          clip.video.id,
          second.id,
          dto.splitSec,
        );
        second.thumbnailUrl = `/api/v1/clips/${second.id}/thumbnail`;
      }

      await this.recordClipUsage(userId, 1, transaction);
      return [first, second];
    });
  }

  async merge(
    userId: string,
    videoId: string,
    dto: MergeClipsDto,
  ): Promise<ClipRecord> {
    const uniqueIds = [...new Set(dto.clipIds)];
    if (uniqueIds.length < 2) {
      throw new BadRequestException(
        'Select at least two different clips to merge',
      );
    }

    const video = await this.getReadyVideo(userId, videoId);
    const clips = await Promise.all(
      uniqueIds.map((clipId) => this.getOwnedEditableClip(userId, clipId)),
    );
    if (clips.some((clip) => clip.video.id !== video.id)) {
      throw new BadRequestException(
        'All clips must belong to the selected video',
      );
    }

    const ordered = clips
      .slice()
      .sort((left, right) => left.startSec - right.startSec);
    const startSec = ordered[0].startSec;
    const endSec = ordered.at(-1)!.endSec;
    this.validateRange(startSec, endSec, video.durationSec);

    return this.prisma.$transaction(async (transaction) => {
      let thumbUrl: string | null = null;
      if (this.mediaAssets && this.ffmpegRender) {
        void this.generateClipThumbnail(
          userId,
          video.id,
          ordered[0].id,
          startSec,
        );
        thumbUrl = `/api/v1/clips/${ordered[0].id}/thumbnail`;
      }

      const merged = await transaction.clip.update({
        where: { id: ordered[0].id },
        data: {
          title: dto.title,
          startSec,
          endSec,
          source: 'MANUAL',
          ...(thumbUrl && { thumbnailUrl: thumbUrl }),
        },
        select: clipSelect,
      });

      await Promise.all(
        ordered
          .slice(1)
          .map((clip) => transaction.clip.delete({ where: { id: clip.id } })),
      );
      return merged;
    });
  }

  async remove(userId: string, clipId: string): Promise<void> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: { id: true, videoId: true },
    });

    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    if (this.prisma.$transaction && this.jobsService) {
      await this.prisma.$transaction(async (tx) => {
        await tx.mediaAsset?.updateMany({
          where: { clipId: clip.id, status: { not: 'DELETED' } },
          data: { status: 'DELETING' },
        });

        await this.jobsService!.enqueue(tx, {
          userId,
          videoId: clip.videoId,
          type: 'CLEANUP',
          payload: { clipId: clip.id, videoId: clip.videoId, userId },
          maxAttempts: 10,
        });

        await tx.clip.delete({ where: { id: clip.id } });
      });
    } else {
      await this.prisma.clip.delete({ where: { id: clip.id } });
    }
  }

  async getPlaybackUrl(
    userId: string,
    clipId: string,
    _options: ClipUrlOptions = {},
  ): Promise<string> {
    const clip = await this.getOwnedStoredClip(userId, clipId);

    if (this.mediaAssets && this.prisma.mediaAsset) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          videoId: clip.video.id,
          kind: { in: ['PROXY', 'SOURCE'] },
          status: 'READY',
        },
        orderBy: { kind: 'asc' },
      });
      if (asset) {
        return this.mediaAssets.signedUrl(asset.storageKey, 3600);
      }
    }

    throw new NotFoundException('Playback asset was not found');
  }

  async getDownloadUrl(
    userId: string,
    clipId: string,
    _options: ClipUrlOptions = {},
  ): Promise<string> {
    const clip = await this.getOwnedStoredClip(userId, clipId);

    if (this.mediaAssets && this.prisma.mediaAsset) {
      const renderAsset = await this.prisma.mediaAsset.findFirst({
        where: { clipId: clip.id, kind: 'RENDER', status: 'READY' },
        orderBy: { createdAt: 'desc' },
      });
      if (renderAsset) {
        return this.mediaAssets.signedUrl(renderAsset.storageKey, 300);
      }
    }

    throw new NotFoundException('Download asset was not found');
  }

  async downloadClipFile(
    clipId: string,
    _filename: string,
    _reframe: boolean,
    res: Response,
  ): Promise<void> {
    if (!this.mediaAssets) {
      throw new NotFoundException('Clip was not found');
    }

    const clip = await this.prisma.clip.findUnique({
      where: { id: clipId },
      include: {
        mediaAssets: {
          where: { kind: 'RENDER', status: 'READY' },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!clip || clip.mediaAssets.length === 0) {
      throw new NotFoundException('Rendered file was not found');
    }

    const downloadUrl = await this.mediaAssets.signedUrl(
      clip.mediaAssets[0].storageKey,
      300,
    );
    res.redirect(downloadUrl);
  }

  async serveThumbnail(clipId: string, res: Response): Promise<void> {
    if (this.mediaAssets) {
      const thumbAsset = await this.prisma.mediaAsset.findFirst({
        where: { clipId, kind: 'THUMB', status: 'READY' },
      });
      if (thumbAsset) {
        const url = await this.mediaAssets.signedUrl(thumbAsset.id, 300);
        return res.redirect(302, url);
      }
    }

    throw new NotFoundException('Clip thumbnail was not found');
  }

  async generateClipThumbnail(
    userId: string,
    videoId: string,
    clipId: string,
    startSec: number,
  ): Promise<string | null> {
    if (!this.mediaAssets || !this.ffmpegRender) return null;
    try {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          videoId,
          kind: { in: ['PROXY', 'SOURCE'] },
          status: 'READY',
        },
        orderBy: { kind: 'asc' },
      });
      if (!asset) return null;

      const signedUrl = await this.mediaAssets.signedUrl(asset.id, 300);
      const tmpDir = tmpdir();
      const localThumbPath = join(tmpDir, `thumb-${clipId}-${Date.now()}.jpg`);

      await this.ffmpegRender.extractThumbnail(
        signedUrl,
        localThumbPath,
        startSec,
      );
      const buffer = await readFile(localThumbPath);
      await this.mediaAssets.putAsset({
        userId,
        videoId,
        clipId,
        kind: 'THUMB',
        body: buffer,
        contentType: 'image/jpeg',
      });

      try {
        await unlink(localThumbPath);
      } catch {
        // ignore
      }

      const thumbnailUrl = `/api/v1/clips/${clipId}/thumbnail`;
      await this.prisma.clip.update({
        where: { id: clipId },
        data: { thumbnailUrl },
      });
      return thumbnailUrl;
    } catch (err) {
      this.logger.warn(
        `Failed to generate clip thumbnail for clip ${clipId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async getOwnedVideo(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: {
        id: true,
        status: true,
        durationSec: true,
      },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    return video;
  }

  private async getReadyVideo(userId: string, videoId: string) {
    const video = await this.getOwnedVideo(userId, videoId);
    this.ensureVideoReady(video);
    return video;
  }

  private async getOwnedStoredClip(userId: string, clipId: string) {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: clipWithVideoSelect,
    });

    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    return clip;
  }

  private async getOwnedEditableClip(userId: string, clipId: string) {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: {
        id: true,
        title: true,
        startSec: true,
        endSec: true,
        thumbnailUrl: true,
        video: {
          select: {
            id: true,
            status: true,
            durationSec: true,
          },
        },
      },
    });
    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }
    return clip;
  }

  private ensureVideoReady(video: {
    status: string;
    durationSec: number | null;
  }): asserts video is { status: 'READY'; durationSec: number } {
    if (video.status !== 'READY' || video.durationSec === null) {
      throw new ConflictException('Video is not ready for clipping');
    }
  }

  private validateRange(
    startSec: number,
    endSec: number,
    videoDurationSec: number,
  ): void {
    if (endSec <= startSec) {
      throw new BadRequestException('endSec must be greater than startSec');
    }

    if (endSec > videoDurationSec) {
      throw new BadRequestException(
        'endSec must not exceed the video duration',
      );
    }

    const clipDurationSec = endSec - startSec;
    if (clipDurationSec < this.minDurationSec) {
      throw new BadRequestException(
        `Clip must be at least ${this.minDurationSec} seconds long`,
      );
    }

    if (clipDurationSec > this.maxDurationSec) {
      throw new BadRequestException(
        `Clip must be at most ${this.maxDurationSec} seconds long`,
      );
    }
  }

  private async recordClipUsage(
    userId: string,
    clipCount = 1,
    client: Pick<PrismaService, 'usageRecord'> = this.prisma,
  ): Promise<void> {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    await client.usageRecord.upsert({
      where: { userId_monthStart: { userId, monthStart } },
      create: { userId, monthStart, uploadedSeconds: 0, clipCount },
      update: { clipCount: { increment: clipCount } },
    });
  }
}
