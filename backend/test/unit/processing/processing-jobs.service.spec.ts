import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ProcessingJob } from '../../../src/generated/prisma/client';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import {
  JOB_STOPPED_MESSAGE,
  type ProcessingQueueClient,
} from '../../../src/processing/processing.constants';
import { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';

function buildJob(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    videoId: 'video-1',
    type: 'TRANSCRIPTION',
    status: 'PENDING',
    bullJobId: 'job-1',
    progress: 0,
    attempts: 0,
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
  it('creates a persisted job and enqueues it', async () => {
    const created = buildJob({ bullJobId: null });
    const persisted = buildJob();
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const ensureQueued = jest.fn();
    const queue: ProcessingQueueClient = { enqueue, ensureQueued };
    const processingJob = {
      create: jest.fn().mockResolvedValue(created),
      update: jest.fn().mockResolvedValue(persisted),
      findMany: jest.fn(),
    };
    const service = new ProcessingJobsService(
      { processingJob } as unknown as PrismaService,
      queue,
    );

    await expect(
      service.createJob({
        userId: 'user-1',
        videoId: 'video-1',
        type: 'TRANSCRIPTION',
      }),
    ).resolves.toEqual(persisted);

    expect(processingJob.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        videoId: 'video-1',
        type: 'TRANSCRIPTION',
        status: 'PENDING',
        payload: undefined,
        bullJobId: undefined,
      },
    });
    expect(enqueue).toHaveBeenCalledWith({
      processingJobId: 'job-1',
      type: 'TRANSCRIPTION',
    });
    expect(processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { bullJobId: 'job-1' },
    });
  });

  it('re-queues persisted pending and running jobs on recovery', async () => {
    const pending = buildJob({ id: 'job-pending', status: 'PENDING' });
    const running = buildJob({ id: 'job-running', status: 'RUNNING' });
    const enqueue = jest.fn();
    const ensureQueued = jest.fn().mockResolvedValue(undefined);
    const queue: ProcessingQueueClient = { enqueue, ensureQueued };
    const processingJob = {
      findMany: jest.fn().mockResolvedValue([pending, running]),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProcessingJobsService(
      { processingJob } as unknown as PrismaService,
      queue,
    );

    await expect(service.recoverPersistedJobs()).resolves.toBe(2);

    expect(processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-running' },
      data: { status: 'PENDING', startedAt: null },
    });
    expect(ensureQueued).toHaveBeenCalledTimes(2);
    expect(ensureQueued).toHaveBeenCalledWith({
      processingJobId: 'job-pending',
      type: 'TRANSCRIPTION',
    });
    expect(ensureQueued).toHaveBeenCalledWith({
      processingJobId: 'job-running',
      type: 'TRANSCRIPTION',
    });
  });

  it('throws when a job is missing', async () => {
    const service = new ProcessingJobsService(
      {
        processingJob: { findUnique: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService,
      { enqueue: jest.fn(), ensureQueued: jest.fn() },
    );

    await expect(service.getById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resets a failed job and re-queues it for another attempt', async () => {
    const failed = buildJob({
      type: 'RENDER',
      status: 'FAILED',
      attempts: 1,
      lastError: 'Timed out waiting for the reel to render',
      failedAt: new Date('2026-09-28T00:01:00.000Z'),
    });
    const reset = buildJob({ type: 'RENDER', attempts: 1 });
    const ensureQueued = jest.fn().mockResolvedValue(undefined);
    const processingJob = {
      findUnique: jest.fn().mockResolvedValue(failed),
      update: jest.fn().mockResolvedValue(reset),
    };
    const service = new ProcessingJobsService(
      { processingJob } as unknown as PrismaService,
      { enqueue: jest.fn(), ensureQueued },
    );

    await expect(service.retryJob('job-1')).resolves.toEqual(reset);

    expect(processingJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: {
        status: 'PENDING',
        progress: 0,
        lastError: null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
      },
    });
    expect(ensureQueued).toHaveBeenCalledWith({
      processingJobId: 'job-1',
      type: 'RENDER',
    });
  });

  it.each(['PENDING', 'RUNNING', 'COMPLETED'] as const)(
    'refuses to retry a %s job',
    async (status) => {
      const ensureQueued = jest.fn();
      const processingJob = {
        findUnique: jest.fn().mockResolvedValue(buildJob({ status })),
        update: jest.fn(),
      };
      const service = new ProcessingJobsService(
        { processingJob } as unknown as PrismaService,
        { enqueue: jest.fn(), ensureQueued },
      );

      await expect(service.retryJob('job-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(processingJob.update).not.toHaveBeenCalled();
      expect(ensureQueued).not.toHaveBeenCalled();
    },
  );

  it.each(['PENDING', 'RUNNING'] as const)(
    'stops a %s job by storing it as failed with the stopped message',
    async (status) => {
      const remove = jest.fn().mockResolvedValue(undefined);
      const stored = buildJob({
        status: 'FAILED',
        lastError: JOB_STOPPED_MESSAGE,
      });
      const processingJob = {
        findUnique: jest.fn().mockResolvedValue(buildJob({ status })),
        update: jest.fn().mockResolvedValue(stored),
      };
      const service = new ProcessingJobsService(
        { processingJob } as unknown as PrismaService,
        { enqueue: jest.fn(), ensureQueued: jest.fn(), remove },
      );

      await expect(service.stopJob('job-1')).resolves.toEqual(stored);

      expect(processingJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: {
          status: 'FAILED',
          failedAt: expect.any(Date) as unknown,
          lastError: JOB_STOPPED_MESSAGE,
        },
      });
      expect(remove).toHaveBeenCalledWith('job-1');
    },
  );

  it.each(['COMPLETED', 'FAILED'] as const)(
    'refuses to stop a %s job',
    async (status) => {
      const processingJob = {
        findUnique: jest.fn().mockResolvedValue(buildJob({ status })),
        update: jest.fn(),
      };
      const service = new ProcessingJobsService(
        { processingJob } as unknown as PrismaService,
        { enqueue: jest.fn(), ensureQueued: jest.fn() },
      );

      await expect(service.stopJob('job-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(processingJob.update).not.toHaveBeenCalled();
    },
  );
});
