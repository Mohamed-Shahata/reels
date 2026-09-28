import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class StaleUploadCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(StaleUploadCleanupService.name);
  private readonly thresholdSec: number;
  private readonly intervalSec: number;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    config: ConfigService<Env, true>,
  ) {
    this.thresholdSec = config.get('STALE_UPLOAD_THRESHOLD_SEC', {
      infer: true,
    });
    this.intervalSec = config.get('STALE_UPLOAD_CLEANUP_INTERVAL_SEC', {
      infer: true,
    });
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.cleanup().catch((error: unknown) => {
        this.logger.error(
          `Stale upload cleanup failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      });
    }, this.intervalSec * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async cleanup(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;

    try {
      const cutoff = new Date(now.getTime() - this.thresholdSec * 1000);
      const staleUploads = await this.prisma.video.findMany({
        where: { status: 'UPLOADING', updatedAt: { lt: cutoff } },
        select: { id: true, userId: true },
      });
      let cleaned = 0;

      for (const upload of staleUploads) {
        try {
          await this.storage.deleteVideo(
            this.storage.getVideoPublicId(upload.userId, upload.id),
          );
          const result = await this.prisma.video.updateMany({
            where: {
              id: upload.id,
              status: 'UPLOADING',
              updatedAt: { lt: cutoff },
            },
            data: { status: 'FAILED' },
          });
          cleaned += result.count;
        } catch (error) {
          this.logger.warn(
            `Could not clean stale upload ${upload.id}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`,
          );
        }
      }

      return cleaned;
    } finally {
      this.running = false;
    }
  }
}
