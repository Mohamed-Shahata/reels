import { Injectable, OnModuleInit } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ProcessingJob } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReelsQueueName } from '../../rabbit/rabbit.constants';
import { RabbitService } from '../../rabbit/rabbit.service';
import { ProcessingJobsService } from '../../processing/processing-jobs.service';
import { AiClipRunsService } from '../../clips/ai-clip-runs.service';
import type { ClipRecord } from '../../clips/clips.service';
import type { AiClipMode } from '../../segmentation/ai-clip-mode';
import { MediaAssetService } from '../../storage/media-asset.service';
import { FfmpegRenderService } from '../../renders/ffmpeg-render.service';
import {
  BaseJobConsumer,
  type JobExecutionContext,
} from '../base/base-job-consumer';
import { FatalJobError } from '../errors/job.error';

export interface SegmentPayload {
  videoId?: string;
  mode?: AiClipMode;
}

@Injectable()
export class SegmentConsumer
  extends BaseJobConsumer<SegmentPayload>
  implements OnModuleInit
{
  protected readonly queue: ReelsQueueName = 'segment';

  constructor(
    prisma: PrismaService,
    rabbit: RabbitService,
    private readonly jobsService: ProcessingJobsService,
    private readonly aiClipRuns: AiClipRunsService,
    private readonly mediaAssets?: MediaAssetService,
    private readonly ffmpegRender?: FfmpegRenderService,
  ) {
    super(prisma, rabbit);
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming(2);
    this.logger.log(
      'SegmentConsumer initialized and listening on queue "segment"',
    );
  }

  protected async handle(
    job: ProcessingJob,
    payload: SegmentPayload,
    ctx: JobExecutionContext,
  ): Promise<void> {
    const videoId = payload.videoId ?? job.videoId;
    if (!videoId) {
      throw new FatalJobError('Segment job missing videoId', {
        code: 'MISSING_VIDEO_ID',
      });
    }

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      throw new FatalJobError(`Video ${videoId} was not found`, {
        code: 'VIDEO_NOT_FOUND',
      });
    }

    // If autoClips is false, skip segmentation
    if (!video.autoClips) {
      await ctx.logEvent(
        'INFO',
        `Auto-clips disabled for video ${video.id}, skipping segmentation`,
      );
      await ctx.updateProgress(100);

      // Enqueue next stage (ANALYZE)
      await this.prisma.$transaction(async (tx) => {
        await this.jobsService.enqueue(tx, {
          userId: video.userId,
          videoId: video.id,
          type: 'ANALYZE',
          payload: {
            videoId: video.id,
          },
        });
      });
      return;
    }

    await ctx.logEvent(
      'INFO',
      `Starting AI segmentation for video ${video.id}`,
    );
    await ctx.updateProgress(15);

    let clips: ClipRecord[] = [];
    try {
      clips = await this.aiClipRuns.run(video.userId, video.id, {
        mode: payload.mode,
      });

      await ctx.logEvent(
        'INFO',
        `AI segmentation created ${clips.length} draft clips`,
        { clipCount: clips.length },
      );
    } catch (err) {
      // If AI run limit reached or rate limit, log as warning so pipeline is not blocked
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('limit') || message.includes('429')) {
        await ctx.logEvent('WARN', `AI segmentation skipped: ${message}`);
      } else {
        throw new FatalJobError(`AI segmentation failed: ${message}`, {
          code: 'SEGMENTATION_FAILED',
          cause: err,
        });
      }
    }

    if (clips.length > 0 && this.mediaAssets && this.ffmpegRender) {
      await this.generateClipThumbnails(video.userId, video.id, clips, ctx);
    }

    await ctx.updateProgress(90);

    // Enqueue ANALYZE job via Transactional Outbox
    await this.prisma.$transaction(async (tx) => {
      await this.jobsService.enqueue(tx, {
        userId: video.userId,
        videoId: video.id,
        type: 'ANALYZE',
        payload: {
          videoId: video.id,
        },
      });
    });

    await ctx.updateProgress(100);
    await ctx.logEvent(
      'INFO',
      'Segmentation stage completed, analyze stage enqueued',
    );
  }

  private async generateClipThumbnails(
    userId: string,
    videoId: string,
    clips: ClipRecord[],
    ctx: JobExecutionContext,
  ): Promise<void> {
    if (!this.mediaAssets || !this.ffmpegRender) return;

    try {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          videoId,
          kind: { in: ['PROXY', 'SOURCE'] },
          status: 'READY',
        },
        orderBy: { kind: 'asc' },
      });

      if (!asset) {
        await ctx.logEvent(
          'WARN',
          'No video proxy or source asset found for clip thumbnails',
        );
        return;
      }

      const localVideoPath = join(ctx.workDir, 'video-proxy.mp4');
      const { stream } = await this.mediaAssets.getAssetStream(asset.id);
      const writeStream = createWriteStream(localVideoPath);
      await pipeline(stream, writeStream);

      for (const clip of clips) {
        if (await ctx.isCancelled()) return;
        const thumbPath = join(ctx.workDir, `thumb-${clip.id}.jpg`);
        try {
          await this.ffmpegRender.extractThumbnail(
            localVideoPath,
            thumbPath,
            clip.startSec,
          );
          const buffer = await readFile(thumbPath);
          await this.mediaAssets.putAsset({
            userId,
            videoId,
            clipId: clip.id,
            kind: 'THUMB',
            body: buffer,
            contentType: 'image/jpeg',
          });
          const thumbnailUrl = `/api/v1/clips/${clip.id}/thumbnail`;
          await this.prisma.clip.update({
            where: { id: clip.id },
            data: { thumbnailUrl },
          });
          clip.thumbnailUrl = thumbnailUrl;
        } catch (err) {
          this.logger.warn(
            `Failed to extract thumbnail for clip ${clip.id}: ${(err as Error).message}`,
          );
        }
      }

      await ctx.logEvent(
        'INFO',
        `Generated thumbnails for ${clips.length} clips`,
      );
    } catch (err) {
      await ctx.logEvent(
        'WARN',
        `Thumbnail generation failed: ${(err as Error).message}`,
      );
    }
  }
}
