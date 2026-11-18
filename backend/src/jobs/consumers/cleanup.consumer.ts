import { Injectable, OnModuleInit } from '@nestjs/common';
import type { ProcessingJob } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ReelsQueueName } from '../../rabbit/rabbit.constants';
import { RabbitService } from '../../rabbit/rabbit.service';
import { S3StorageService } from '../../storage/s3-storage.service';
import {
  BaseJobConsumer,
  type JobExecutionContext,
} from '../base/base-job-consumer';

export interface CleanupPayload {
  videoId?: string;
  clipId?: string;
  userId?: string;
}

@Injectable()
export class CleanupConsumer
  extends BaseJobConsumer<CleanupPayload>
  implements OnModuleInit
{
  protected readonly queue: ReelsQueueName = 'cleanup';

  constructor(
    prisma: PrismaService,
    rabbit: RabbitService,
    private readonly s3: S3StorageService,
  ) {
    super(prisma, rabbit);
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming(2);
    this.logger.log(
      'CleanupConsumer initialized and listening on queue "cleanup"',
    );
  }

  protected async handle(
    job: ProcessingJob,
    payload: CleanupPayload,
    ctx: JobExecutionContext,
  ): Promise<void> {
    const videoId = payload.videoId ?? job.videoId;
    const clipId = payload.clipId;
    const userId = payload.userId ?? job.userId;

    await ctx.logEvent('INFO', `Starting cleanup for job ${job.id}`, {
      videoId,
      clipId,
      userId,
    });

    if (clipId) {
      await this.cleanupClip(clipId, ctx);
    } else if (videoId) {
      await this.cleanupVideo(videoId, userId, ctx);
    } else {
      await ctx.logEvent(
        'WARN',
        `Cleanup job ${job.id} has neither videoId nor clipId`,
      );
    }

    await ctx.updateProgress(100);
    await ctx.logEvent(
      'INFO',
      `Cleanup completed successfully for job ${job.id}`,
    );
  }

  private async cleanupVideo(
    videoId: string,
    userId: string,
    ctx: JobExecutionContext,
  ): Promise<void> {
    // 1. Collect all MediaAsset storage keys for this video
    const assets = await this.prisma.mediaAsset.findMany({
      where: { videoId },
      select: { storageKey: true },
    });
    const trackedKeys = assets.map((a) => a.storageKey);

    // 2. Scan S3 prefix for this video to ensure no orphaned files remain
    let s3Keys: string[] = [];
    try {
      const prefix = `users/${userId}/videos/${videoId}/`;
      const listed = await this.s3.list(prefix);
      s3Keys = listed.map((item) => item.key);
    } catch (err) {
      this.logger.warn(
        `Failed to list S3 prefix for video ${videoId}: ${(err as Error).message}`,
      );
    }

    const allKeys = [...new Set([...trackedKeys, ...s3Keys])];

    if (allKeys.length > 0) {
      await ctx.logEvent(
        'INFO',
        `Deleting ${allKeys.length} S3 objects for video ${videoId}`,
      );
      await this.s3.deleteObjects(allKeys);
    }

    // 3. Mark MediaAssets as DELETED
    await this.prisma.mediaAsset.updateMany({
      where: { videoId },
      data: { status: 'DELETED' },
    });

    // 4. Hard delete the Video record (Prisma cascade deletes child records)
    await this.prisma.video.deleteMany({
      where: { id: videoId },
    });

    await ctx.logEvent(
      'INFO',
      `Video record ${videoId} and associated assets deleted`,
    );
  }

  private async cleanupClip(
    clipId: string,
    ctx: JobExecutionContext,
  ): Promise<void> {
    const assets = await this.prisma.mediaAsset.findMany({
      where: { clipId },
      select: { storageKey: true },
    });
    const keys = assets.map((a) => a.storageKey);

    if (keys.length > 0) {
      await ctx.logEvent(
        'INFO',
        `Deleting ${keys.length} S3 objects for clip ${clipId}`,
      );
      await this.s3.deleteObjects(keys);
    }

    await this.prisma.mediaAsset.updateMany({
      where: { clipId },
      data: { status: 'DELETED' },
    });

    await this.prisma.clip.deleteMany({
      where: { id: clipId },
    });

    await ctx.logEvent(
      'INFO',
      `Clip record ${clipId} and associated assets deleted`,
    );
  }
}
