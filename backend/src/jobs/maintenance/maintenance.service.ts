import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaService } from '../../prisma/prisma.service';
import type { S3StorageService } from '../../storage/s3-storage.service';
import type { ProcessingJobsService } from '../../processing/processing-jobs.service';
import { withAdvisoryLock } from '../helpers/advisory-lock.helper';

export const MAINTENANCE_LOCK_IDS = {
  PURGE_FAILED_UPLOADS: 7823468,
  PURGE_EXPIRED_RENDERS: 7823469,
  PURGE_SOFT_DELETED: 7823470,
  ORPHAN_SWEEP: 7823471,
  TEMP_SWEEP: 7823472,
} as const;

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private hourlyTimer: NodeJS.Timeout | null = null;
  private dailyTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly tempDir = join(tmpdir(), 'reelcast');

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3StorageService,
    private readonly jobsService: ProcessingJobsService,
  ) {}

  onModuleInit(): void {
    this.isRunning = true;

    // Run temp-sweep immediately on worker startup
    void this.tempSweep();

    // Schedule hourly tasks: purge-failed-uploads, purge-expired-renders, purge-soft-deleted, temp-sweep
    this.hourlyTimer = setInterval(() => {
      void this.runHourlyTasks();
    }, 3_600_000);

    // Schedule daily tasks: orphan-sweep
    this.dailyTimer = setInterval(() => {
      void this.orphanSweep();
    }, 86_400_000);

    this.logger.log(
      'MaintenanceService initialized (hourly and daily schedules active)',
    );
  }

  onModuleDestroy(): void {
    this.isRunning = false;
    if (this.hourlyTimer) {
      clearInterval(this.hourlyTimer);
      this.hourlyTimer = null;
    }
    if (this.dailyTimer) {
      clearInterval(this.dailyTimer);
      this.dailyTimer = null;
    }
    this.logger.log('MaintenanceService stopped');
  }

  async runHourlyTasks(): Promise<void> {
    if (!this.isRunning) return;
    await this.purgeFailedUploads();
    await this.purgeExpiredRenders();
    await this.purgeSoftDeleted();
    await this.tempSweep();
  }

  /**
   * Cleans up temporary files in tmpdir/reelcast older than 2 hours.
   */
  async tempSweep(): Promise<number> {
    return (
      (await withAdvisoryLock(
        this.prisma,
        MAINTENANCE_LOCK_IDS.TEMP_SWEEP,
        async () => {
          let cleanedCount = 0;
          try {
            const entries = await readdir(this.tempDir).catch(() => []);
            const threshold = Date.now() - 2 * 3_600_000; // older than 2 hours

            for (const entry of entries) {
              const fullPath = join(this.tempDir, entry);
              try {
                const info = await stat(fullPath);
                if (info.mtimeMs < threshold) {
                  await rm(fullPath, { recursive: true, force: true });
                  cleanedCount++;
                }
              } catch {
                // Ignore concurrent deletion
              }
            }

            if (cleanedCount > 0) {
              this.logger.log(
                `Temp-sweep removed ${cleanedCount} stale directories from ${this.tempDir}`,
              );
            }
          } catch (err) {
            this.logger.warn(
              `Temp-sweep failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          return cleanedCount;
        },
      )) ?? 0
    );
  }

  /**
   * Purges uploads that stayed in UPLOADING status for more than 24 hours.
   * Aborts active S3 multipart uploads and removes the video record.
   */
  async purgeFailedUploads(): Promise<number> {
    return (
      (await withAdvisoryLock(
        this.prisma,
        MAINTENANCE_LOCK_IDS.PURGE_FAILED_UPLOADS,
        async () => {
          const threshold = new Date(Date.now() - 24 * 3_600_000);

          const staleUploads = await this.prisma.video.findMany({
            where: {
              status: 'UPLOADING',
              createdAt: { lt: threshold },
            },
            select: {
              id: true,
              userId: true,
              mediaAssets: {
                where: { kind: 'SOURCE' },
                select: { storageKey: true },
              },
            },
          });

          if (staleUploads.length === 0) return 0;

          let count = 0;
          for (const video of staleUploads) {
            try {
              const storageKey =
                video.mediaAssets[0]?.storageKey ??
                `users/${video.userId}/videos/${video.id}/source.mp4`;

              const uploadId =
                await this.s3.findActiveMultipartUpload(storageKey);
              if (uploadId) {
                await this.s3.abortMultipart(storageKey, uploadId);
              }

              await this.prisma.video.delete({ where: { id: video.id } });
              count++;
            } catch (err) {
              this.logger.warn(
                `Failed to purge stale upload ${video.id}: ${(err as Error).message}`,
              );
            }
          }

          if (count > 0) {
            this.logger.log(
              `Purged ${count} failed uploads older than 24 hours`,
            );
          }
          return count;
        },
      )) ?? 0
    );
  }

  /**
   * Purges expired renders whose expiresAt has passed.
   * Deletes files from S3 and marks MediaAsset as DELETED.
   */
  async purgeExpiredRenders(): Promise<number> {
    return (
      (await withAdvisoryLock(
        this.prisma,
        MAINTENANCE_LOCK_IDS.PURGE_EXPIRED_RENDERS,
        async () => {
          const now = new Date();

          const expired = await this.prisma.mediaAsset.findMany({
            where: {
              kind: 'RENDER',
              status: 'READY',
              expiresAt: { lt: now },
            },
            select: { id: true, storageKey: true },
          });

          if (expired.length === 0) return 0;

          const keys = expired.map((e) => e.storageKey);
          await this.s3.deleteObjects(keys);

          await this.prisma.$transaction(async (tx) => {
            await tx.mediaAsset.updateMany({
              where: { id: { in: expired.map((e) => e.id) } },
              data: { status: 'DELETED' },
            });

            await tx.clipRender.updateMany({
              where: { assetId: { in: expired.map((e) => e.id) } },
              data: { outputUrl: null },
            });
          });

          this.logger.log(`Purged ${expired.length} expired render assets`);
          return expired.length;
        },
      )) ?? 0
    );
  }

  /**
   * Finds soft-deleted videos stuck in DELETING for more than 1 hour and reenqueues CLEANUP.
   */
  async purgeSoftDeleted(): Promise<number> {
    return (
      (await withAdvisoryLock(
        this.prisma,
        MAINTENANCE_LOCK_IDS.PURGE_SOFT_DELETED,
        async () => {
          const oneHourAgo = new Date(Date.now() - 3_600_000);

          const stuckVideos = await this.prisma.video.findMany({
            where: {
              status: 'DELETING',
              deletedAt: { lt: oneHourAgo },
            },
            select: { id: true, userId: true },
          });

          if (stuckVideos.length === 0) return 0;

          let count = 0;
          for (const video of stuckVideos) {
            try {
              await this.prisma.$transaction(async (tx) => {
                await this.jobsService.enqueue(tx, {
                  userId: video.userId,
                  videoId: video.id,
                  type: 'CLEANUP',
                  payload: { videoId: video.id, userId: video.userId },
                  maxAttempts: 10,
                });
              });
              count++;
            } catch (err) {
              this.logger.warn(
                `Failed to republish cleanup for stuck video ${video.id}: ${(err as Error).message}`,
              );
            }
          }

          if (count > 0) {
            this.logger.log(
              `Republished cleanup for ${count} stuck soft-deleted videos`,
            );
          }
          return count;
        },
      )) ?? 0
    );
  }

  /**
   * Compares S3 bucket listing with MediaAsset records.
   * Deletes unreferenced objects older than 24 hours.
   */
  async orphanSweep(): Promise<number> {
    return (
      (await withAdvisoryLock(
        this.prisma,
        MAINTENANCE_LOCK_IDS.ORPHAN_SWEEP,
        async () => {
          const threshold = new Date(Date.now() - 24 * 3_600_000);
          const allObjects = await this.s3.list('');

          // Filter objects older than 24 hours
          const candidates = allObjects.filter(
            (o) => o.lastModified && o.lastModified < threshold,
          );

          if (candidates.length === 0) return 0;

          // Check presence in MediaAsset table in batches of 100
          const orphanedKeys: string[] = [];
          const batchSize = 100;

          for (let i = 0; i < candidates.length; i += batchSize) {
            const batch = candidates.slice(i, i + batchSize);
            const batchKeys = batch.map((b) => b.key);

            const trackedAssets = await this.prisma.mediaAsset.findMany({
              where: {
                storageKey: { in: batchKeys },
                status: { not: 'DELETED' },
              },
              select: { storageKey: true },
            });

            const trackedSet = new Set(trackedAssets.map((a) => a.storageKey));
            for (const item of batch) {
              if (!trackedSet.has(item.key)) {
                orphanedKeys.push(item.key);
              }
            }
          }

          if (orphanedKeys.length > 0) {
            await this.s3.deleteObjects(orphanedKeys);
            this.logger.log(
              `Orphan-sweep deleted ${orphanedKeys.length} unreferenced objects from storage`,
            );
          }

          return orphanedKeys.length;
        },
      )) ?? 0
    );
  }
}
