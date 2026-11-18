import { NotFoundException, ConflictException } from '@nestjs/common';
import { JobsController } from '../../../src/jobs/jobs.controller';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import type { AuthContext } from '../../../src/auth/jwt-auth.guard';
import type { ProcessingJob } from '../../../src/generated/prisma/client';

describe('JobsController', () => {
  let controller: JobsController;
  let jobsService: {
    retryJob: jest.Mock;
    cancelJob: jest.Mock;
  };

  const mockAuth: AuthContext = {
    userId: 'user-1',
    sessionId: 'session-1',
  };

  const sampleJob: ProcessingJob = {
    id: 'job-123',
    userId: 'user-1',
    videoId: 'video-123',
    type: 'TRANSCRIBE',
    status: 'QUEUED',
    progress: 0,
    attempt: 1,
    maxAttempts: 5,
    idempotencyKey: 'video-123:TRANSCRIBE:1',
    bullJobId: null,
    payload: null,
    lockedBy: null,
    heartbeatAt: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    errorCode: null,
    lastError: null,
    createdAt: new Date('2026-11-14T10:00:00Z'),
    updatedAt: new Date('2026-11-14T10:00:00Z'),
  };

  beforeEach(() => {
    jobsService = {
      retryJob: jest.fn(),
      cancelJob: jest.fn(),
    };
    controller = new JobsController(
      jobsService as unknown as ProcessingJobsService,
    );
  });

  describe('POST /jobs/:id/retry', () => {
    it('retries a failed job and returns structured job details', async () => {
      jobsService.retryJob.mockResolvedValue({
        ...sampleJob,
        status: 'QUEUED',
        attempt: 0,
      });

      const result = await controller.retry(mockAuth, 'job-123');

      expect(jobsService.retryJob).toHaveBeenCalledWith('job-123', 'user-1');
      expect(result).toEqual({
        id: 'job-123',
        type: 'TRANSCRIBE',
        status: 'QUEUED',
        attempt: 0,
        maxAttempts: 5,
        errorCode: null,
        lastError: null,
        createdAt: sampleJob.createdAt,
        updatedAt: sampleJob.updatedAt,
      });
    });

    it('propagates error when retry is not allowed', async () => {
      jobsService.retryJob.mockRejectedValue(
        new ConflictException('Only failed jobs can be retried'),
      );

      await expect(controller.retry(mockAuth, 'job-123')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('POST /jobs/:id/cancel', () => {
    it('cancels an active job and returns structured cancellation details', async () => {
      jobsService.cancelJob.mockResolvedValue({
        ...sampleJob,
        status: 'CANCELLED',
        errorCode: 'CANCELLED_BY_USER',
        lastError: 'Cancelled by the user',
      });

      const result = await controller.cancel(mockAuth, 'job-123');

      expect(jobsService.cancelJob).toHaveBeenCalledWith('job-123', 'user-1');
      expect(result).toEqual({
        id: 'job-123',
        type: 'TRANSCRIBE',
        status: 'CANCELLED',
        errorCode: 'CANCELLED_BY_USER',
        lastError: 'Cancelled by the user',
        createdAt: sampleJob.createdAt,
        updatedAt: sampleJob.updatedAt,
      });
    });

    it('propagates error when job is not found or cannot be cancelled', async () => {
      jobsService.cancelJob.mockRejectedValue(
        new NotFoundException('Processing job not found'),
      );

      await expect(
        controller.cancel(mockAuth, 'job-not-found'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
