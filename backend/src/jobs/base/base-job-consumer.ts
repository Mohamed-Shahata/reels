import { mkdir, rm, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import type { Prisma, ProcessingJob } from '../../generated/prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  REELS_EXCHANGES,
  type ReelsQueueName,
} from '../../rabbit/rabbit.constants';
import type { RabbitService } from '../../rabbit/rabbit.service';
import {
  AppJobError,
  RetryableJobError,
  JOB_ERROR_CODES,
  isJobRetryable,
} from '../errors/job.error';

export interface JobExecutionContext {
  readonly jobId: string;
  readonly videoId: string | null;
  readonly workDir: string;
  isCancelled(): Promise<boolean>;
  updateProgress(progress: number): Promise<void>;
  logEvent(
    level: 'INFO' | 'WARN' | 'ERROR',
    message: string,
    data?: unknown,
  ): Promise<void>;
  heartbeat(): Promise<void>;
}

export interface BaseJobMessagePayload {
  processingJobId: string;
  videoId?: string | null;
  userId?: string;
  type: string;
  payload?: unknown;
}

export abstract class BaseJobConsumer<TPayload = unknown> {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly workerId: string = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly rabbit: RabbitService,
    protected readonly workdirRoot: string = join(tmpdir(), 'reelcast'),
  ) {}

  protected abstract readonly queue: ReelsQueueName;
  protected abstract handle(
    job: ProcessingJob,
    payload: TPayload,
    ctx: JobExecutionContext,
  ): Promise<void>;

  getQueueName(): ReelsQueueName {
    return this.queue;
  }

  async startConsuming(prefetch = 1): Promise<void> {
    await this.rabbit.consume<BaseJobMessagePayload>(
      this.queue,
      async (msg, parsed, ack, nack) => {
        await this.onMessage(msg, parsed, ack, nack);
      },
      { prefetch },
    );
  }

  async onMessage(
    msg: ConsumeMessage,
    payload: BaseJobMessagePayload,
    ack: () => void,
    _nack: (requeue?: boolean) => void,
  ): Promise<void> {
    const jobId = payload.processingJobId;
    if (!jobId) {
      this.logger.error(
        `Received message without processingJobId on queue ${this.queue}`,
      );
      ack();
      return;
    }

    // 1. Idempotent claim
    const claimedJob = await this.claimJob(jobId);
    if (!claimedJob) {
      this.logger.log(
        `Job ${jobId} could not be claimed (already running, cancelled, or completed). Skipping.`,
      );
      ack();
      return;
    }

    const workDir = join(this.workdirRoot, jobId);
    await mkdir(workDir, { recursive: true });

    // 2. Setup Heartbeat
    let heartbeatTimer: NodeJS.Timeout | null = setInterval(() => {
      void this.sendHeartbeat(jobId);
    }, 15_000);

    const ctx: JobExecutionContext = {
      jobId,
      videoId: claimedJob.videoId,
      workDir,
      isCancelled: async () => {
        const current = await this.prisma.processingJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });
        return current?.status === 'CANCELLED';
      },
      updateProgress: async (progress: number) => {
        const clamped = Math.min(100, Math.max(0, Math.round(progress)));
        await this.prisma.processingJob.update({
          where: { id: jobId },
          data: { progress: clamped },
        });
      },
      logEvent: async (level, message, data) => {
        await this.logJobEvent(jobId, level, message, data);
      },
      heartbeat: async () => {
        await this.sendHeartbeat(jobId);
      },
    };

    try {
      this.logStructured('log', 'job_started', {
        jobId,
        videoId: claimedJob.videoId,
      });
      await this.logJobEvent(
        jobId,
        'INFO',
        `Started processing job on ${this.queue} queue`,
      );

      // Check cancel before starting
      if (await ctx.isCancelled()) {
        this.logStructured('warn', 'job_cancelled', {
          jobId,
          videoId: claimedJob.videoId,
          reason: 'Cancelled before execution',
        });
        await this.logJobEvent(
          jobId,
          'WARN',
          'Job was cancelled before execution',
        );
        ack();
        return;
      }

      // 2.5 Disk space hygiene check
      await this.checkDiskSpace();

      // 3. Execute handler
      await this.handle(claimedJob, payload.payload as TPayload, ctx);

      // Check if job was cancelled during execution
      if (await ctx.isCancelled()) {
        this.logStructured('warn', 'job_cancelled', {
          jobId,
          videoId: claimedJob.videoId,
          reason: 'Cancelled during execution',
        });
        await this.logJobEvent(
          jobId,
          'WARN',
          'Job execution stopped due to user cancellation',
        );
        ack();
        return;
      }

      // 4. Mark Completed
      await this.prisma.processingJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          completedAt: new Date(),
          lastError: null,
          errorCode: null,
        },
      });

      if (claimedJob.videoId) {
        await this.updateVideoStatus(claimedJob.videoId);
      }

      this.logStructured('log', 'job_completed', {
        jobId,
        videoId: claimedJob.videoId,
      });
      await this.logJobEvent(jobId, 'INFO', 'Job completed successfully');
      ack();
    } catch (err) {
      await this.handleJobError(claimedJob, err, msg, ack);
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      try {
        await rm(workDir, { recursive: true, force: true });
      } catch (cleanErr) {
        this.logger.warn(
          `Could not clean workdir for job ${jobId}: ${(cleanErr as Error).message}`,
        );
      }
    }
  }

  protected async checkDiskSpace(): Promise<void> {
    try {
      if (typeof statfs === 'function') {
        const stats = await statfs(this.workdirRoot).catch(() => null);
        if (
          stats &&
          typeof stats.bavail === 'number' &&
          typeof stats.bsize === 'number'
        ) {
          const freeBytes = stats.bavail * stats.bsize;
          const minFreeBytes = 500 * 1024 * 1024; // 500MB minimum
          if (freeBytes < minFreeBytes) {
            throw new RetryableJobError(
              `Insufficient disk space on worker: ${Math.round(freeBytes / (1024 * 1024))}MB available, ${Math.round(minFreeBytes / (1024 * 1024))}MB required`,
              { code: JOB_ERROR_CODES.INSUFFICIENT_DISK_SPACE },
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof AppJobError) throw err;
    }
  }

  protected async updateVideoStatus(videoId: string): Promise<void> {
    try {
      const video = await this.prisma.video.findUnique({
        where: { id: videoId },
        select: { id: true, status: true },
      });
      if (!video || video.status === 'DELETING') return;

      const jobs = await this.prisma.processingJob.findMany({
        where: { videoId },
        select: { type: true, status: true },
      });

      const requiredStages: Array<
        'INGEST' | 'TRANSCRIBE' | 'SEGMENT' | 'ANALYZE'
      > = ['INGEST', 'TRANSCRIBE', 'SEGMENT', 'ANALYZE'];

      const allCompleted = requiredStages.every((stage) =>
        jobs.some(
          (j) =>
            j.type === stage &&
            (j.status === 'COMPLETED' || j.status === 'CANCELLED'),
        ),
      );

      if (allCompleted) {
        await this.prisma.video.update({
          where: { id: videoId },
          data: { status: 'READY', failedStage: null },
        });
      }
    } catch (err) {
      this.logger.warn(
        `Failed to aggregate video status for ${videoId}: ${(err as Error).message}`,
      );
    }
  }

  private async claimJob(jobId: string): Promise<ProcessingJob | null> {
    const rows = await this.prisma.$queryRaw<ProcessingJob[]>`
      UPDATE "ProcessingJob"
      SET "status" = 'RUNNING'::"JobStatus",
          "lockedBy" = ${this.workerId},
          "heartbeatAt" = NOW()
      WHERE "id" = ${jobId} AND "status" IN ('QUEUED'::"JobStatus", 'RETRYING'::"JobStatus")
      RETURNING *;
    `;

    return rows?.[0] ?? null;
  }

  private async sendHeartbeat(jobId: string): Promise<void> {
    try {
      await this.prisma.processingJob.update({
        where: { id: jobId },
        data: { heartbeatAt: new Date() },
      });
    } catch {
      // Ignored if job completed or missing
    }
  }

  private async logJobEvent(
    jobId: string,
    level: string,
    message: string,
    data?: unknown,
  ): Promise<void> {
    try {
      await this.prisma.jobEvent.create({
        data: {
          jobId,
          level,
          message,
          data: data ? (data as Prisma.InputJsonValue) : undefined,
        },
      });
    } catch (e) {
      this.logger.warn(
        `Failed to create JobEvent for ${jobId}: ${(e as Error).message}`,
      );
    }
  }

  protected logStructured(
    level: 'log' | 'warn' | 'error',
    event: string,
    meta: {
      jobId: string;
      videoId?: string | null;
      stage?: string;
      [key: string]: unknown;
    },
  ): void {
    const record = {
      timestamp: new Date().toISOString(),
      event,
      videoId: meta.videoId ?? null,
      stage: meta.stage ?? this.queue,
      workerId: this.workerId,
      ...meta,
    };
    if (level === 'error') {
      this.logger.error(JSON.stringify(record));
    } else if (level === 'warn') {
      this.logger.warn(JSON.stringify(record));
    } else {
      this.logger.log(JSON.stringify(record));
    }
  }

  private async handleJobError(
    job: ProcessingJob,
    err: unknown,
    msg: ConsumeMessage,
    ack: () => void,
  ): Promise<void> {
    const error = err as Error;
    const errorCode =
      err instanceof AppJobError ? err.code : 'UNEXPECTED_ERROR';
    const retryable = isJobRetryable(err);
    const nextAttempt = job.attempt + 1;

    this.logStructured('error', 'job_failed', {
      jobId: job.id,
      videoId: job.videoId,
      error: error.message,
      errorCode,
      retryable,
      attempt: nextAttempt,
      maxAttempts: job.maxAttempts,
    });

    if (retryable && nextAttempt < job.maxAttempts) {
      // Retry tier calculation (10s -> 1m -> 5m)
      const tier = nextAttempt === 1 ? '10s' : nextAttempt === 2 ? '1m' : '5m';
      const retryRoutingKey = `${this.queue}.retry.${tier}`;

      await this.prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: 'RETRYING',
          attempt: nextAttempt,
          lastError: error.message,
          errorCode,
        },
      });

      await this.logJobEvent(
        job.id,
        'WARN',
        `Job failed with retryable error (${errorCode}). Scheduling attempt ${nextAttempt} via tier ${tier}`,
        { error: error.message, nextAttempt, tier },
      );

      // Publish to retry exchange
      await this.rabbit.publish(
        REELS_EXCHANGES.RETRY,
        retryRoutingKey,
        JSON.parse(msg.content.toString('utf-8')),
        {
          headers: {
            'x-attempt': nextAttempt,
          },
        },
      );

      ack();
    } else {
      // Fatal error or max attempts reached -> Dead Letter Queue (DLQ)
      await this.prisma.processingJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          attempt: nextAttempt,
          lastError: error.message,
          errorCode,
          failedAt: new Date(),
        },
      });

      if (job.videoId) {
        try {
          await this.prisma.video.updateMany({
            where: { id: job.videoId },
            data: {
              status: 'FAILED',
              failedStage: job.type,
            },
          });
        } catch {
          // ignore if video was deleted
        }
      }

      await this.logJobEvent(
        job.id,
        'ERROR',
        `Job failed permanently (${retryable ? 'Max attempts exceeded' : 'Fatal error'}). Moving to DLQ.`,
        { error: error.message, errorCode, finalAttempt: nextAttempt },
      );

      // Publish to DLQ via DLX
      await this.rabbit.publish(
        REELS_EXCHANGES.DLX,
        `${this.queue}.dead`,
        JSON.parse(msg.content.toString('utf-8')),
        {
          headers: {
            'x-death-reason': error.message,
            'x-error-code': errorCode,
          },
        },
      );

      ack();
    }
  }
}
