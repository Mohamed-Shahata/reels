import {
  CleanupConsumer,
  type CleanupPayload,
} from '../../../src/jobs/consumers/cleanup.consumer';
import type { ProcessingJob } from '../../../src/generated/prisma/client';
import type { JobExecutionContext } from '../../../src/jobs/base/base-job-consumer';

describe('CleanupConsumer', () => {
  let consumer: CleanupConsumer;
  let mockPrisma: any;
  let mockRabbit: any;
  let mockS3: any;
  let mockCtx: JobExecutionContext;

  beforeEach(() => {
    mockPrisma = {
      mediaAsset: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      video: {
        deleteMany: jest.fn(),
      },
      clip: {
        deleteMany: jest.fn(),
      },
      processingJob: {
        update: jest.fn(),
      },
      jobEvent: {
        create: jest.fn(),
      },
    };

    mockRabbit = {
      consume: jest.fn(),
      publish: jest.fn(),
    };

    mockS3 = {
      list: jest.fn(),
      deleteObjects: jest.fn(),
    };

    mockCtx = {
      jobId: 'job-clean-1',
      videoId: 'v1',
      workDir: '/tmp/test',
      isCancelled: jest.fn().mockResolvedValue(false),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    consumer = new CleanupConsumer(mockPrisma, mockRabbit, mockS3);
  });

  it('has queue name "cleanup"', () => {
    expect(consumer.getQueueName()).toBe('cleanup');
  });

  describe('cleanupVideo flow', () => {
    const job: ProcessingJob = {
      id: 'job-clean-1',
      userId: 'u1',
      videoId: 'v1',
      type: 'CLEANUP',
      status: 'RUNNING',
      attempt: 1,
      maxAttempts: 10,
      lockedBy: 'worker-1',
      heartbeatAt: new Date(),
      idempotencyKey: 'clean-v1',
      errorCode: null,
      lastError: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      failedAt: null,
      progress: 0,
      payload: {},
      updatedAt: new Date(),
      bullJobId: null,
    };

    const payload: CleanupPayload = {
      videoId: 'v1',
      userId: 'u1',
    };

    it('collects tracked media assets + scans S3 prefix, batch deletes S3 objects, marks assets DELETED, and hard deletes video', async () => {
      mockPrisma.mediaAsset.findMany.mockResolvedValue([
        { storageKey: 'users/u1/videos/v1/source.mp4' },
        { storageKey: 'users/u1/videos/v1/audio.mp3' },
        { storageKey: 'users/u1/videos/v1/clips/c1/thumb.jpg' },
      ]);

      mockS3.list.mockResolvedValue([
        { key: 'users/u1/videos/v1/source.mp4', size: 1000 },
        { key: 'users/u1/videos/v1/untracked-proxy.mp4', size: 500 },
      ]);

      mockS3.deleteObjects.mockResolvedValue(undefined);
      mockPrisma.mediaAsset.updateMany.mockResolvedValue({ count: 3 });
      mockPrisma.video.deleteMany.mockResolvedValue({ count: 1 });

      await (consumer as any).handle(job, payload, mockCtx);

      expect(mockPrisma.mediaAsset.findMany).toHaveBeenCalledWith({
        where: { videoId: 'v1' },
        select: { storageKey: true },
      });

      expect(mockS3.list).toHaveBeenCalledWith('users/u1/videos/v1/');

      expect(mockS3.deleteObjects).toHaveBeenCalledWith(
        expect.arrayContaining([
          'users/u1/videos/v1/source.mp4',
          'users/u1/videos/v1/audio.mp3',
          'users/u1/videos/v1/clips/c1/thumb.jpg',
          'users/u1/videos/v1/untracked-proxy.mp4',
        ]),
      );

      expect(mockPrisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { videoId: 'v1' },
        data: { status: 'DELETED' },
      });

      expect(mockPrisma.video.deleteMany).toHaveBeenCalledWith({
        where: { id: 'v1' },
      });

      expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);
    });
  });

  describe('cleanupClip flow', () => {
    const job: ProcessingJob = {
      id: 'job-clean-clip-1',
      userId: 'u1',
      videoId: 'v1',
      type: 'CLEANUP',
      status: 'RUNNING',
      attempt: 1,
      maxAttempts: 10,
      lockedBy: 'worker-1',
      heartbeatAt: new Date(),
      idempotencyKey: 'clean-c1',
      errorCode: null,
      lastError: null,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      failedAt: null,
      progress: 0,
      payload: {},
      updatedAt: new Date(),
      bullJobId: null,
    };

    const payload: CleanupPayload = {
      clipId: 'c1',
      videoId: 'v1',
      userId: 'u1',
    };

    it('deletes clip media assets from S3, marks them DELETED, and hard deletes clip', async () => {
      mockPrisma.mediaAsset.findMany.mockResolvedValue([
        { storageKey: 'users/u1/videos/v1/clips/c1/thumb.jpg' },
        { storageKey: 'users/u1/videos/v1/clips/c1/renders/r1.mp4' },
      ]);
      mockS3.deleteObjects.mockResolvedValue(undefined);
      mockPrisma.mediaAsset.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.clip.deleteMany.mockResolvedValue({ count: 1 });

      await (consumer as any).handle(job, payload, mockCtx);

      expect(mockS3.deleteObjects).toHaveBeenCalledWith([
        'users/u1/videos/v1/clips/c1/thumb.jpg',
        'users/u1/videos/v1/clips/c1/renders/r1.mp4',
      ]);

      expect(mockPrisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { clipId: 'c1' },
        data: { status: 'DELETED' },
      });

      expect(mockPrisma.clip.deleteMany).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
    });
  });
});
