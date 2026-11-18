import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ProcessingJob } from '../../../src/generated/prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';

function buildJob(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    videoId: 'video-1',
    type: 'TRANSCRIBE',
    status: 'QUEUED',
    idempotencyKey: 'video-1:TRANSCRIBE:123',
    bullJobId: null,
    progress: 0,
    attempt: 0,
    maxAttempts: 5,
    lockedBy: null,
    heartbeatAt: null,
    errorCode: null,
    lastError: null,
    payload: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    createdAt: new Date('2026-09-28T00:00:00.000Z'),
    updatedAt: new Date('2026-09-28T00:00:00.000Z'),
    ...overrides,
  };
}

describe('ProcessingJobsService', () => {
  it('creates a persisted job and enqueues it to outbox via transaction', async () => {
    const persisted = buildJob();
    const processingJob = {
      create: jest.fn().mockResolvedValue(persisted),
    };
    const outboxEvent = {
      create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };
    const tx = { processingJob, outboxEvent };
    const prisma = {
      processingJob,
      outboxEvent,
      $transaction: jest.fn(
        async (cb: (txArg: typeof tx) => Promise<unknown>) => cb(tx),
      ),
    };
    const service = new ProcessingJobsService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.createJob({
        userId: 'user-1',
        videoId: 'video-1',
        type: 'TRANSCRIBE',
      }),
    ).resolves.toEqual(persisted);

    expect(processingJob.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        videoId: 'video-1',
        type: 'TRANSCRIBE',
        status: 'QUEUED',
        idempotencyKey: expect.stringContaining('video-1:TRANSCRIBE:'),
        maxAttempts: 5,
        payload: undefined,
      },
    });
    expect(outboxEvent.create).toHaveBeenCalledWith({
      data: {
        routingKey: 'transcribe',
        payload: {
          processingJobId: 'job-1',
          videoId: 'video-1',
          userId: 'user-1',
          type: 'TRANSCRIBE',
          payload: undefined,
        },
      },
    });
  });

  it('throws when a job is missing', async () => {
    const service = new ProcessingJobsService({
      processingJob: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService);

    await expect(service.getById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resets a failed job and writes retry event to outbox', async () => {
    const failed = buildJob({
      type: 'RENDER',
      status: 'FAILED',
      attempt: 1,
      lastError: 'Timed out waiting for the reel to render',
      failedAt: new Date('2026-09-28T00:01:00.000Z'),
    });
    const reset = buildJob({ type: 'RENDER', attempt: 1 });
    const processingJob = {
      findUnique: jest.fn().mockResolvedValue(failed),
      update: jest.fn().mockResolvedValue(reset),
    };
    const outboxEvent = {
      create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
    };
    const jobEvent = {
      create: jest.fn().mockResolvedValue({ id: 'event-1' }),
    };
    const tx = {
      processingJob,
      outboxEvent,
      jobEvent,
    };
    const prisma = {
      processingJob,
      outboxEvent,
      jobEvent,
      $transaction: jest.fn(
        async (cb: (txArg: typeof tx) => Promise<unknown>) => cb(tx),
      ),
    };
    const service = new ProcessingJobsService(
      prisma as unknown as PrismaService,
    );

    await expect(service.retryJob('job-1')).resolves.toEqual(reset);

    expect(processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
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
    expect(outboxEvent.create).toHaveBeenCalledWith({
      data: {
        routingKey: 'render',
        payload: {
          processingJobId: 'job-1',
          videoId: 'video-1',
          userId: 'user-1',
          type: 'RENDER',
          payload: null,
        },
      },
    });
    expect(jobEvent.create).toHaveBeenCalledWith({
      data: {
        jobId: 'job-1',
        level: 'INFO',
        message: 'Job retried by user for stage RENDER',
      },
    });
  });

  it.each(['QUEUED', 'RUNNING', 'COMPLETED'] as const)(
    'refuses to retry a %s job',
    async (status) => {
      const processingJob = {
        findUnique: jest.fn().mockResolvedValue(buildJob({ status })),
        update: jest.fn(),
      };
      const service = new ProcessingJobsService({
        processingJob,
      } as unknown as PrismaService);

      await expect(service.retryJob('job-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(processingJob.update).not.toHaveBeenCalled();
    },
  );

  it.each(['QUEUED', 'RUNNING', 'RETRYING'] as const)(
    'cancels a %s job by storing it as cancelled',
    async (status) => {
      const stored = buildJob({
        status: 'CANCELLED',
        lastError: 'Cancelled by the user',
        errorCode: 'CANCELLED_BY_USER',
      });
      const processingJob = {
        findUnique: jest.fn().mockResolvedValue(buildJob({ status })),
        update: jest.fn().mockResolvedValue(stored),
      };
      const jobEvent = {
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      };
      const service = new ProcessingJobsService({
        processingJob,
        jobEvent,
      } as unknown as PrismaService);

      await expect(service.cancelJob('job-1')).resolves.toEqual(stored);

      expect(processingJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: 'CANCELLED',
          failedAt: expect.any(Date) as unknown,
          lastError: 'Cancelled by the user',
          errorCode: 'CANCELLED_BY_USER',
        },
      });
      expect(jobEvent.create).toHaveBeenCalledWith({
        data: {
          jobId: 'job-1',
          level: 'WARN',
          message: 'Job was cancelled by the user',
        },
      });
    },
  );

  it.each(['COMPLETED', 'FAILED'] as const)(
    'refuses to cancel a %s job',
    async (status) => {
      const processingJob = {
        findUnique: jest.fn().mockResolvedValue(buildJob({ status })),
        update: jest.fn(),
      };
      const service = new ProcessingJobsService({
        processingJob,
      } as unknown as PrismaService);

      await expect(service.cancelJob('job-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(processingJob.update).not.toHaveBeenCalled();
    },
  );

  describe('enqueue (Transactional Outbox)', () => {
    it('creates ProcessingJob and OutboxEvent in the same transaction', async () => {
      const mockJob = buildJob({
        id: 'job-outbox-1',
        idempotencyKey: 'video-1:TRANSCRIBE:custom',
        type: 'TRANSCRIBE',
        maxAttempts: 5,
      });
      const tx = {
        processingJob: {
          create: jest.fn().mockResolvedValue(mockJob),
        },
        outboxEvent: {
          create: jest.fn().mockResolvedValue({ id: 'outbox-1' }),
        },
      };

      const service = new ProcessingJobsService({} as unknown as PrismaService);

      const result = await service.enqueue(
        tx as unknown as Parameters<typeof service.enqueue>[0],
        {
          userId: 'user-1',
          videoId: 'video-1',
          type: 'TRANSCRIBE',
          idempotencyKey: 'video-1:TRANSCRIBE:custom',
          payload: { test: true },
        },
      );

      expect(result).toEqual(mockJob);
      expect(tx.processingJob.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          videoId: 'video-1',
          type: 'TRANSCRIBE',
          status: 'QUEUED',
          idempotencyKey: 'video-1:TRANSCRIBE:custom',
          maxAttempts: 5,
          payload: { test: true },
        },
      });
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          routingKey: 'transcribe',
          payload: {
            processingJobId: 'job-outbox-1',
            videoId: 'video-1',
            userId: 'user-1',
            type: 'TRANSCRIBE',
            payload: { test: true },
          },
        },
      });
    });
  });
});
