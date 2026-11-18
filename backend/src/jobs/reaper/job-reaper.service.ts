import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { withAdvisoryLock } from '../helpers/advisory-lock.helper';
import { jobTypeToRoutingKey } from '../../processing/processing-jobs.service';

export const REAPER_ADVISORY_LOCK_ID = 7823467;

@Injectable()
export class JobReaperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobReaperService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.isRunning = true;
    this.timer = setInterval(() => {
      void this.reapDeadJobs();
    }, 60_000);
    this.logger.log('JobReaperService initialized (scheduled every 60s)');
  }

  onModuleDestroy(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('JobReaperService stopped');
  }

  async reapDeadJobs(): Promise<number> {
    if (!this.isRunning) return 0;

    return (
      (await withAdvisoryLock(
        this.prisma,
        REAPER_ADVISORY_LOCK_ID,
        async () => {
          return this.executeReap();
        },
      )) ?? 0
    );
  }

  private async executeReap(): Promise<number> {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

    // Find running jobs with dead heartbeat
    const staleJobs = await this.prisma.processingJob.findMany({
      where: {
        status: 'RUNNING',
        heartbeatAt: {
          lt: twoMinutesAgo,
        },
      },
    });

    if (staleJobs.length === 0) {
      return 0;
    }

    this.logger.warn(
      `Found ${staleJobs.length} dead/stale jobs with expired heartbeat`,
    );
    let reapedCount = 0;

    for (const job of staleJobs) {
      const nextAttempt = job.attempt + 1;
      const rk = jobTypeToRoutingKey(job.type);

      await this.prisma.$transaction(async (tx) => {
        if (nextAttempt < job.maxAttempts) {
          // Re-queue dead job
          await tx.processingJob.update({
            where: { id: job.id },
            data: {
              status: 'RETRYING',
              attempt: nextAttempt,
              lockedBy: null,
              heartbeatAt: null,
              lastError: 'Job worker heartbeat timed out (recovered by reaper)',
              errorCode: 'WORKER_HEARTBEAT_TIMEOUT',
            },
          });

          await tx.outboxEvent.create({
            data: {
              routingKey: rk,
              payload: {
                processingJobId: job.id,
                videoId: job.videoId,
                userId: job.userId,
                type: job.type,
                payload: job.payload,
              },
            },
          });

          await tx.jobEvent.create({
            data: {
              jobId: job.id,
              level: 'WARN',
              message: `Reaper recovered dead job (worker heartbeat timed out). Scheduled attempt ${nextAttempt}`,
            },
          });

          this.logger.log(
            `Reaper recovered job ${job.id} for retry attempt ${nextAttempt}`,
          );
        } else {
          // Exceeded max attempts -> Fail permanently
          await tx.processingJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              attempt: nextAttempt,
              lockedBy: null,
              heartbeatAt: null,
              failedAt: new Date(),
              lastError:
                'Job worker heartbeat timed out (max attempts exceeded)',
              errorCode: 'WORKER_HEARTBEAT_TIMEOUT',
            },
          });

          await tx.jobEvent.create({
            data: {
              jobId: job.id,
              level: 'ERROR',
              message:
                'Job failed permanently: worker heartbeat timed out and max attempts exceeded',
            },
          });

          this.logger.error(
            `Job ${job.id} failed permanently due to heartbeat timeout`,
          );
        }
      });

      reapedCount++;
    }

    return reapedCount;
  }
}
