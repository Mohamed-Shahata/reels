import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ProcessingJob } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReelsQueueName } from '../../rabbit/rabbit.constants';
import { RabbitService } from '../../rabbit/rabbit.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import {
  MediaAssetService,
  buildAssetStorageKey,
} from '../../storage/media-asset.service';
import type { Env } from '../../config/env.schema';
import {
  BaseJobConsumer,
  type JobExecutionContext,
} from '../base/base-job-consumer';
import { FatalJobError } from '../errors/job.error';
import {
  FfmpegRenderService,
  type FaceTrackPoint,
  type SpeakerTurn,
} from '../../renders/ffmpeg-render.service';
import { buildAssSubtitles } from '../../subtitles/ass-builder';
import type { SubtitleCue } from '../../subtitles/subtitle-cue-builder';
import type { SubtitleStyle } from '../../subtitles/subtitle-style';

export interface RenderPayload {
  clipRenderId?: string;
  videoId?: string;
  clipId?: string;
}

@Injectable()
export class RenderConsumer
  extends BaseJobConsumer<RenderPayload>
  implements OnModuleInit
{
  protected readonly queue: ReelsQueueName = 'render';
  private readonly concurrency: number;
  private readonly retentionDays: number;
  private readonly downloadTtlSec: number;

  constructor(
    prisma: PrismaService,
    rabbit: RabbitService,
    private readonly s3: S3StorageService,
    private readonly mediaAssets: MediaAssetService,
    private readonly ffmpegRender: FfmpegRenderService,
    config: ConfigService<Env, true>,
  ) {
    super(prisma, rabbit);
    this.concurrency = config.get('WORKER_CONCURRENCY_RENDER', { infer: true });
    this.retentionDays = config.get('RENDER_RETENTION_DAYS', { infer: true });
    this.downloadTtlSec = config.get('DOWNLOAD_URL_TTL_SEC', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming(this.concurrency);
    this.logger.log(
      `RenderConsumer initialized and listening on queue "render" (concurrency: ${this.concurrency})`,
    );
  }

  protected async handle(
    job: ProcessingJob,
    payload: RenderPayload,
    ctx: JobExecutionContext,
  ): Promise<void> {
    const clipRenderId = payload.clipRenderId;
    if (!clipRenderId) {
      throw new FatalJobError('Render job missing clipRenderId', {
        code: 'MISSING_CLIP_RENDER_ID',
      });
    }

    const render = await this.prisma.clipRender.findUnique({
      where: { id: clipRenderId },
      include: {
        clip: {
          include: {
            video: {
              include: {
                mediaAssets: true,
                reframePlan: true,
              },
            },
          },
        },
      },
    });

    if (!render || !render.clip || !render.clip.video) {
      throw new FatalJobError(`ClipRender ${clipRenderId} was not found`, {
        code: 'RENDER_NOT_FOUND',
      });
    }

    const { clip } = render;
    const { video } = clip;

    // 1. Check idempotency: hash(clipId, startSec, endSec, subtitleKey, planVersion)
    const planVersion = video.reframePlan?.version ?? 1;
    const subtitleKey =
      render.subtitleKey ?? (render.subtitleStyle ? 'styled' : 'none');
    const renderHash = createHash('sha256')
      .update(
        `${clip.id}:${render.startSec}:${render.endSec}:${subtitleKey}:${planVersion}`,
      )
      .digest('hex')
      .substring(0, 16);

    await ctx.logEvent('INFO', `Render idempotency signature: ${renderHash}`);

    const storageKey = buildAssetStorageKey({
      userId: video.userId,
      videoId: video.id,
      clipId: clip.id,
      renderId: render.id,
      kind: 'RENDER',
    });

    // Check if an existing MediaAsset for this render storageKey is already READY
    const existingAsset = await this.prisma.mediaAsset.findFirst({
      where: {
        clipId: clip.id,
        kind: 'RENDER',
        storageKey,
        status: 'READY',
      },
    });

    if (existingAsset) {
      await ctx.logEvent(
        'INFO',
        `Found reusable render asset ${existingAsset.id} (idempotent cache hit)`,
      );
      const signedUrl = await this.mediaAssets.signedUrl(
        existingAsset.id,
        this.downloadTtlSec,
      );
      await this.prisma.clipRender.update({
        where: { id: render.id },
        data: {
          assetId: existingAsset.id,
          outputUrl: signedUrl,
        },
      });
      await ctx.updateProgress(100);
      return;
    }

    // 2. Find SOURCE video asset
    const sourceAsset = video.mediaAssets.find(
      (a) =>
        a.kind === 'SOURCE' && (a.status === 'READY' || a.status === 'PENDING'),
    );

    if (!sourceAsset) {
      throw new FatalJobError(
        `Source media asset for video ${video.id} was not found`,
        {
          code: 'SOURCE_ASSET_NOT_FOUND',
        },
      );
    }

    await ctx.logEvent(
      'INFO',
      `Preparing source video for clip "${clip.title}" (${render.startSec}s - ${render.endSec}s)`,
    );
    await ctx.updateProgress(10);

    // 3. Download source video to workdir
    const ext = extname(sourceAsset.storageKey) || '.mp4';
    const localSourcePath = join(ctx.workDir, `source${ext}`);
    const sourceStream = await this.s3.getObjectStream(sourceAsset.storageKey);
    const fileWriteStream = createWriteStream(localSourcePath);
    await pipeline(sourceStream, fileWriteStream);

    await ctx.heartbeat();
    await ctx.updateProgress(20);

    // 4. Subtitles preparation (if requested)
    let assSubtitlePath: string | undefined;
    if (render.subtitleStyle && render.subtitleCues) {
      const cues = (render.subtitleCues as unknown as SubtitleCue[]) || [];
      const style = render.subtitleStyle as unknown as Partial<SubtitleStyle>;
      if (cues.length > 0) {
        const assContent = buildAssSubtitles(cues, {
          style,
          playResX: 1080,
          playResY: 1920,
        });
        assSubtitlePath = join(ctx.workDir, 'subtitles.ass');
        await writeFile(assSubtitlePath, assContent, 'utf-8');
        await ctx.logEvent(
          'INFO',
          `Generated ASS subtitles with ${cues.length} cues`,
        );
      }
    }

    // 5. Execute FFmpeg render
    const localOutputPath = join(ctx.workDir, `render-${render.id}.mp4`);
    const fontsDir = join(process.cwd(), 'assets', 'fonts');

    await ctx.logEvent(
      'INFO',
      `Rendering clip with layout: ${clip.layout}, contentType: ${video.contentType}`,
    );

    // Create abort controller tied to ctx cancellation check
    const abortController = new AbortController();
    const heartbeatInterval = setInterval(() => {
      void (async () => {
        try {
          const isCancelled = await ctx.isCancelled();
          if (isCancelled) {
            abortController.abort();
          } else {
            await ctx.heartbeat();
          }
        } catch {
          // ignore heartbeat errors in timer
        }
      })();
    }, 10_000);

    try {
      await this.ffmpegRender.renderClip({
        sourceVideoPath: localSourcePath,
        outputPath: localOutputPath,
        startSec: render.startSec,
        endSec: render.endSec,
        layout: clip.layout,
        contentType: video.contentType,
        reframePlan: video.reframePlan
          ? {
              contentType: video.reframePlan.contentType,
              faces: video.reframePlan.faces as unknown as FaceTrackPoint[],
              speakerTurns: video.reframePlan
                .speakerTurns as unknown as SpeakerTurn[],
            }
          : null,
        assSubtitlePath,
        fontsDir,
        targetWidth: 1080,
        targetHeight: 1920,
        onProgress: async (percent) => {
          // Scale render progress between 25% and 85%
          const overallProgress = Math.round(25 + (percent / 100) * 60);
          await ctx.updateProgress(overallProgress);
        },
        signal: abortController.signal,
      });
    } finally {
      clearInterval(heartbeatInterval);
    }

    await ctx.heartbeat();
    await ctx.updateProgress(90);

    // 6. Upload rendered MP4 to storage as MediaAsset(kind=RENDER)
    const renderBuffer = await readFile(localOutputPath);
    const expiresAt = new Date(
      Date.now() + this.retentionDays * 24 * 60 * 60 * 1000,
    );

    const asset = await this.mediaAssets.putAsset({
      userId: video.userId,
      videoId: video.id,
      clipId: clip.id,
      renderId: render.id,
      kind: 'RENDER',
      body: renderBuffer,
      contentType: 'video/mp4',
      expiresAt,
    });

    const signedUrl = await this.mediaAssets.signedUrl(
      asset.id,
      this.downloadTtlSec,
    );

    // 7. Update ClipRender with assetId and outputUrl
    await this.prisma.clipRender.update({
      where: { id: render.id },
      data: {
        assetId: asset.id,
        outputUrl: signedUrl,
      },
    });

    await ctx.logEvent(
      'INFO',
      `Render completed successfully and saved to ${storageKey}`,
    );
    await ctx.updateProgress(100);
  }
}
