import {
  SegmentConsumer,
  type SegmentPayload,
} from '../../../src/jobs/consumers/segment.consumer';
import { FatalJobError } from '../../../src/jobs/errors/job.error';
import type {
  ProcessingJob,
  Video,
} from '../../../src/generated/prisma/client';
import type { JobExecutionContext } from '../../../src/jobs/base/base-job-consumer';

describe('SegmentConsumer', () => {
  let consumer: SegmentConsumer;
  let mockPrisma: any;
  let mockRabbit: any;
  let mockJobsService: any;
  let mockAiClipRuns: any;
  let mockCtx: JobExecutionContext;

  beforeEach(() => {
    mockPrisma = {
      video: {
        findUnique: jest.fn(),
      },
      processingJob: {
        update: jest.fn(),
      },
      jobEvent: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => {
        return cb(mockPrisma);
      }),
    };

    mockRabbit = {
      consume: jest.fn(),
      publish: jest.fn(),
    };

    mockJobsService = {
      enqueue: jest.fn().mockResolvedValue({ id: 'job-analyze-1' }),
    };

    mockAiClipRuns = {
      run: jest.fn(),
    };

    mockCtx = {
      jobId: 'job-segment-1',
      videoId: 'v1',
      workDir: '/tmp/reelcast/job-segment-1',
      isCancelled: jest.fn().mockResolvedValue(false),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    consumer = new SegmentConsumer(
      mockPrisma,
      mockRabbit,
      mockJobsService,
      mockAiClipRuns,
    );
  });

  it('has queue name "segment"', () => {
    expect(consumer.getQueueName()).toBe('segment');
  });

  describe('handle flow', () => {
    const mockJob: ProcessingJob = {
      id: 'job-segment-1',
      userId: 'u1',
      videoId: 'v1',
      type: 'SEGMENT',
      status: 'RUNNING',
      attempt: 1,
      maxAttempts: 3,
      lockedBy: 'worker-1',
      heartbeatAt: new Date(),
      idempotencyKey: 'segment-v1',
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

    const mockVideo: Video = {
      id: 'v1',
      userId: 'u1',
      title: 'Test Video',
      language: 'ar',
      status: 'PROCESSING',
      durationSec: 300,
      contentType: 'PODCAST',
      sizeBytes: BigInt(1024),
      autoClips: true,
      failedStage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    it('throws FatalJobError if videoId is missing', async () => {
      const jobWithoutVideo = { ...mockJob, videoId: null };
      await expect(
        (consumer as any).handle(jobWithoutVideo, {}, mockCtx),
      ).rejects.toThrow(FatalJobError);
    });

    it('throws FatalJobError if video is not found', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(null);
      await expect(
        (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx),
      ).rejects.toThrow('Video v1 was not found');
    });

    it('skips segmentation when autoClips is false and enqueues ANALYZE', async () => {
      mockPrisma.video.findUnique.mockResolvedValue({
        ...mockVideo,
        autoClips: false,
      });

      const payload: SegmentPayload = { videoId: 'v1' };
      await (consumer as any).handle(mockJob, payload, mockCtx);

      // aiClipRuns not called
      expect(mockAiClipRuns.run).not.toHaveBeenCalled();

      // Progress reached 100
      expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);

      // ANALYZE enqueued
      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          type: 'ANALYZE',
          payload: { videoId: 'v1' },
        }),
      );
    });

    it('runs AI segmentation when autoClips is true, creates draft clips, and enqueues ANALYZE', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockAiClipRuns.run.mockResolvedValue([
        { id: 'clip-1', title: 'Highlight 1' },
        { id: 'clip-2', title: 'Highlight 2' },
      ]);

      const payload: SegmentPayload = { videoId: 'v1', mode: 'HIGHLIGHTS' };
      await (consumer as any).handle(mockJob, payload, mockCtx);

      expect(mockAiClipRuns.run).toHaveBeenCalledWith('u1', 'v1', {
        mode: 'HIGHLIGHTS',
      });

      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          type: 'ANALYZE',
          payload: { videoId: 'v1' },
        }),
      );

      expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);
    });

    it('generates thumbnails for created clips when mediaAssets and ffmpegRender are present', async () => {
      const mockMediaAssets: any = {
        getAssetStream: jest.fn().mockResolvedValue({
          stream: {
            pipe: jest.fn(),
            on: jest.fn((event, cb) => {
              if (event === 'end') cb();
              return this;
            }),
          },
        }),
        putAsset: jest.fn().mockResolvedValue({ id: 'thumb-asset-1' }),
      };
      const mockFfmpeg: any = {
        extractThumbnail: jest.fn().mockResolvedValue(undefined),
      };
      mockPrisma.mediaAsset = {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'proxy-1', storageKey: 'proxy.mp4' }),
      };
      mockPrisma.clip = {
        update: jest.fn().mockResolvedValue({}),
      };

      const segmentWithThumbs = new SegmentConsumer(
        mockPrisma,
        mockRabbit,
        mockJobsService,
        mockAiClipRuns,
        mockMediaAssets,
        mockFfmpeg,
      );

      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockAiClipRuns.run.mockResolvedValue([
        { id: 'clip-1', title: 'Highlight 1', startSec: 10 },
      ]);

      // Mock generateClipThumbnails execution or test private method
      await (segmentWithThumbs as any).generateClipThumbnails(
        'u1',
        'v1',
        [{ id: 'clip-1', title: 'Highlight 1', startSec: 10 }],
        mockCtx,
      );

      expect(mockPrisma.mediaAsset.findFirst).toHaveBeenCalledWith({
        where: {
          videoId: 'v1',
          kind: { in: ['PROXY', 'SOURCE'] },
          status: 'READY',
        },
        orderBy: { kind: 'asc' },
      });
    });

    it('logs warning and still enqueues ANALYZE when AI run limit is reached', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockAiClipRuns.run.mockRejectedValue(
        new Error('Monthly AI run limit of 20 has been reached'),
      );

      const payload: SegmentPayload = { videoId: 'v1' };
      await (consumer as any).handle(mockJob, payload, mockCtx);

      expect(mockCtx.logEvent).toHaveBeenCalledWith(
        'WARN',
        expect.stringContaining(
          'AI segmentation skipped: Monthly AI run limit',
        ),
      );

      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          type: 'ANALYZE',
        }),
      );
    });

    it('throws FatalJobError when unexpected fatal error occurs during segmentation', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockAiClipRuns.run.mockRejectedValue(
        new Error('Groq invalid model parameter format'),
      );

      await expect(
        (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx),
      ).rejects.toThrow(FatalJobError);
    });
  });
});
