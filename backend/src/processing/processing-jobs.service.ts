import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ProcessingJob,
  JobStatus,
  JobType,
  Prisma,
} from '../generated/prisma/client';
import { describeError } from '../common/errors/describe-error';
import { PrismaService } from '../prisma/prisma.service';

export type ProcessingJobStatus = JobStatus;
export type ProcessingJobType = JobType;

export const DEFAULT_JOB_MAX_ATTEMPTS: Record<JobType, number> = {
  INGEST: 3,
  TRANSCRIBE: 5,
  SEGMENT: 3,
  ANALYZE: 3,
  RENDER: 3,
  CLEANUP: 10,
};

export function jobTypeToRoutingKey(type: JobType): string {
  switch (type) {
    case 'INGEST':
      return 'ingest';
    case 'TRANSCRIBE':
      return 'transcribe';
    case 'SEGMENT':
      return 'segment';
    case 'ANALYZE':
      return 'analyze';
    case 'RENDER':
      return 'render';
    case 'CLEANUP':
      return 'cleanup';
  }
}

export interface EnqueueJobInput {
  userId: string;
  videoId?: string;
  type: JobType;
  payload?: Prisma.InputJsonValue;
  idempotencyKey?: string;
  maxAttempts?: number;
}

export interface CreateProcessingJobInput {
  userId: string;
  videoId?: string;
  type: ProcessingJobType;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class ProcessingJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueue(
    tx: Prisma.TransactionClient,
    input: EnqueueJobInput,
  ): Promise<ProcessingJob> {
    const idempotencyKey =
      input.idempotencyKey ??
      `${input.videoId ?? input.userId}:${input.type}:${Date.now()}`;
    const maxAttempts =
      input.maxAttempts ?? DEFAULT_JOB_MAX_ATTEMPTS[input.type] ?? 3;

    const job = await tx.processingJob.create({
      data: {
        userId: input.userId,
        videoId: input.videoId,
        type: input.type,
        status: 'QUEUED',
        idempotencyKey,
        maxAttempts,
        payload: input.payload,
      },
    });

    const routingKey = jobTypeToRoutingKey(input.type);
    const outboxPayload = {
      processingJobId: job.id,
      videoId: job.videoId,
      userId: job.userId,
      type: job.type,
      payload: input.payload,
    };

    await tx.outboxEvent.create({
      data: {
        routingKey,
        payload: outboxPayload,
      },
    });

    return job;
  }

  async createJob(input: CreateProcessingJobInput): Promise<ProcessingJob> {
    return this.prisma.$transaction(async (tx) => {
      return this.enqueue(tx, {
        userId: input.userId,
        videoId: input.videoId,
        type: input.type,
        payload: input.payload,
      });
    });
  }

  async getById(id: string): Promise<ProcessingJob> {
    const job = await this.prisma.processingJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException('Processing job not found');
    }
    return job;
  }

  async markRunning(id: string): Promise<ProcessingJob> {
    return this.updateStatus(id, 'RUNNING', {
      startedAt: new Date(),
      progress: 0,
      attempt: { increment: 1 },
    });
  }

  async updateProgress(id: string, progress: number): Promise<ProcessingJob> {
    try {
      return await this.prisma.processingJob.update({
        where: { id },
        data: { progress: Math.min(100, Math.max(0, Math.round(progress))) },
      });
    } catch {
      throw new NotFoundException('Processing job not found');
    }
  }

  async markCompleted(id: string, progress = 100): Promise<ProcessingJob> {
    return this.updateStatus(id, 'COMPLETED', {
      completedAt: new Date(),
      progress,
      lastError: null,
    });
  }

  async markFailed(id: string, error: unknown): Promise<ProcessingJob> {
    const message = describeError(error, 'Processing job failed');
    return this.updateStatus(id, 'FAILED', {
      failedAt: new Date(),
      lastError: message,
    });
  }

  async cancelJob(id: string, userId?: string): Promise<ProcessingJob> {
    const job = await this.getById(id);
    if (userId && job.userId !== userId) {
      throw new NotFoundException('Processing job not found');
    }

    if (
      job.status !== 'QUEUED' &&
      job.status !== 'RUNNING' &&
      job.status !== 'RETRYING'
    ) {
      throw new ConflictException('Only a job in progress can be cancelled');
    }

    const cancelled = await this.updateStatus(id, 'CANCELLED', {
      failedAt: new Date(),
      lastError: 'Cancelled by the user',
      errorCode: 'CANCELLED_BY_USER',
    });

    try {
      await this.prisma.jobEvent.create({
        data: {
          jobId: id,
          level: 'WARN',
          message: 'Job was cancelled by the user',
        },
      });
    } catch {
      // Ignored
    }

    return cancelled;
  }

  async retryJob(id: string, userId?: string): Promise<ProcessingJob> {
    const job = await this.getById(id);
    if (userId && job.userId !== userId) {
      throw new NotFoundException('Processing job not found');
    }

    if (job.status !== 'FAILED') {
      throw new ConflictException('Only failed jobs can be retried');
    }

    const routingKey = jobTypeToRoutingKey(job.type);

    return this.prisma.$transaction(async (tx) => {
      const reset = await tx.processingJob.update({
        where: { id },
        data: {
          status: 'QUEUED',
          progress: 0,
          errorCode: null,
          lastError: null,
          startedAt: null,
          completedAt: null,
          failedAt: null,
          lockedBy: null,
          heartbeatAt: null,
        },
      });

      await tx.outboxEvent.create({
        data: {
          routingKey,
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
          jobId: id,
          level: 'INFO',
          message: `Job retried by user for stage ${job.type}`,
        },
      });

      return reset;
    });
  }

  private async updateStatus(
    id: string,
    status: JobStatus,
    data: Prisma.ProcessingJobUpdateInput,
  ): Promise<ProcessingJob> {
    try {
      return await this.prisma.processingJob.update({
        where: { id },
        data: { status, ...data },
      });
    } catch {
      throw new NotFoundException('Processing job not found');
    }
  }
}

export { ProcessingJobsService as JobsService };
