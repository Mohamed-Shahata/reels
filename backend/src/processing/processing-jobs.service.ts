import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ProcessingJob,
  ProcessingJobStatus,
  ProcessingJobType,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InjectProcessingQueue } from './processing-queue.decorator';
import type { ProcessingQueueClient } from './processing.constants';

export interface CreateProcessingJobInput {
  userId: string;
  videoId?: string;
  type: ProcessingJobType;
  payload?: Prisma.InputJsonValue;
}

@Injectable()
export class ProcessingJobsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectProcessingQueue()
    private readonly queue: ProcessingQueueClient,
  ) {}

  async createJob(input: CreateProcessingJobInput): Promise<ProcessingJob> {
    const job = await this.prisma.processingJob.create({
      data: {
        userId: input.userId,
        videoId: input.videoId,
        type: input.type,
        status: 'PENDING',
        payload: input.payload,
        bullJobId: undefined,
      },
    });

    await this.queue.enqueue({
      processingJobId: job.id,
      type: job.type,
    });

    return this.prisma.processingJob.update({
      where: { id: job.id },
      data: { bullJobId: job.id },
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
      attempts: { increment: 1 },
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
    const message =
      error instanceof Error ? error.message : 'Processing job failed';
    return this.updateStatus(id, 'FAILED', {
      failedAt: new Date(),
      lastError: message,
    });
  }

  async retryJob(id: string): Promise<ProcessingJob> {
    const job = await this.getById(id);
    if (job.status !== 'FAILED') {
      throw new ConflictException('Only failed jobs can be retried');
    }

    const reset = await this.updateStatus(id, 'PENDING', {
      progress: 0,
      lastError: null,
      startedAt: null,
      completedAt: null,
      failedAt: null,
    });
    await this.queue.ensureQueued({ processingJobId: id, type: job.type });
    return reset;
  }

  async recoverPersistedJobs(): Promise<number> {
    const jobs = await this.prisma.processingJob.findMany({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      orderBy: { createdAt: 'asc' },
    });

    let recovered = 0;
    for (const job of jobs) {
      if (job.status === 'RUNNING') {
        await this.prisma.processingJob.update({
          where: { id: job.id },
          data: {
            status: 'PENDING',
            startedAt: null,
          },
        });
      }

      await this.queue.ensureQueued({
        processingJobId: job.id,
        type: job.type,
      });
      recovered += 1;
    }

    return recovered;
  }

  private async updateStatus(
    id: string,
    status: ProcessingJobStatus,
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
