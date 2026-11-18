import {
  AnalyzeConsumer,
  type AnalyzePayload,
} from '../../../src/jobs/consumers/analyze.consumer';
import { FatalJobError } from '../../../src/jobs/errors/job.error';
import type { ProcessingJob } from '../../../src/generated/prisma/client';
import type { JobExecutionContext } from '../../../src/jobs/base/base-job-consumer';

describe('AnalyzeConsumer', () => {
  let consumer: AnalyzeConsumer;
  let mockPrisma: any;
  let mockRabbit: any;
  let mockMediaAssets: any;
  let mockConfig: any;
  let mockCtx: JobExecutionContext;

  beforeEach(() => {
    mockPrisma = {
      video: {
        findUnique: jest.fn(),
      },
      reframePlan: {
        upsert: jest.fn().mockResolvedValue({ id: 'plan-1' }),
      },
      transcriptSegment: {
        update: jest.fn().mockResolvedValue({ id: 'seg-1' }),
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

    mockMediaAssets = {
      getSignedUrl: jest
        .fn()
        .mockResolvedValue('https://s3.example.com/proxy.mp4'),
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'ANALYZER_URL') return 'http://localhost:8001';
        return null;
      }),
    };

    mockCtx = {
      jobId: 'job-analyze-1',
      videoId: 'v1',
      workDir: '/tmp/reelcast/job-analyze-1',
      isCancelled: jest.fn().mockResolvedValue(false),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    consumer = new AnalyzeConsumer(
      mockPrisma,
      mockRabbit,
      mockMediaAssets,
      mockConfig,
    );
  });

  it('has queue name "analyze"', () => {
    expect(consumer.getQueueName()).toBe('analyze');
  });

  describe('handle flow', () => {
    const mockJob: ProcessingJob = {
      id: 'job-analyze-1',
      userId: 'u1',
      videoId: 'v1',
      type: 'ANALYZE',
      status: 'RUNNING',
      attempt: 1,
      maxAttempts: 3,
      lockedBy: 'worker-1',
      heartbeatAt: new Date(),
      idempotencyKey: 'analyze-v1',
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

    const mockSoloVideo = {
      id: 'v1',
      userId: 'u1',
      title: 'Solo Video',
      contentType: 'SOLO' as const,
      status: 'PROCESSING',
      durationSec: 60,
      mediaAssets: [{ storageKey: 'users/u1/videos/v1/proxy-720p.mp4' }],
      transcript: {
        segments: [{ id: 'seg-1', startSec: 0, endSec: 10, speaker: null }],
      },
    };

    const mockPodcastVideo = {
      id: 'v2',
      userId: 'u1',
      title: 'Podcast Video',
      contentType: 'PODCAST' as const,
      status: 'PROCESSING',
      durationSec: 120,
      mediaAssets: [{ storageKey: 'users/u1/videos/v2/proxy-720p.mp4' }],
      transcript: {
        segments: [
          { id: 'seg-1', startSec: 0, endSec: 10, speaker: null },
          { id: 'seg-2', startSec: 15, endSec: 25, speaker: null },
        ],
      },
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

    it('successfully processes SOLO video, upserts ReframePlan with solo face track, and completes', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockSoloVideo);

      // Global fetch returns solo analysis
      const fakeFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          videoId: 'v1',
          version: 1,
          contentType: 'SOLO',
          faces: [
            {
              speaker: 0,
              label: 'solo_speaker',
              centerNormX: 0.5,
              centerNormY: 0.4,
              box: { x: 0.35, y: 0.2, w: 0.3, h: 0.4 },
            },
          ],
          speakerTurns: null,
        }),
      });
      global.fetch = fakeFetch;

      const payload: AnalyzePayload = { videoId: 'v1' };
      await (consumer as any).handle(mockJob, payload, mockCtx);

      expect(mockPrisma.reframePlan.upsert).toHaveBeenCalledWith({
        where: { videoId: 'v1' },
        create: expect.objectContaining({
          videoId: 'v1',
          contentType: 'SOLO',
          version: 1,
          faces: expect.arrayContaining([
            expect.objectContaining({ label: 'solo_speaker' }),
          ]),
        }),
        update: expect.anything(),
      });

      expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);
    });

    it('successfully processes PODCAST video, updates TranscriptSegment.speaker, and completes', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockPodcastVideo);

      const fakeFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          videoId: 'v2',
          version: 1,
          contentType: 'PODCAST',
          faces: [
            {
              speaker: 0,
              label: 'speaker_left',
              centerNormX: 0.3,
              centerNormY: 0.4,
              box: { x: 0.15, y: 0.2, w: 0.3, h: 0.4 },
            },
            {
              speaker: 1,
              label: 'speaker_right',
              centerNormX: 0.7,
              centerNormY: 0.4,
              box: { x: 0.55, y: 0.2, w: 0.3, h: 0.4 },
            },
          ],
          speakerTurns: [
            { speaker: 0, startSec: 0, endSec: 12 },
            { speaker: 1, startSec: 12, endSec: 30 },
          ],
        }),
      });
      global.fetch = fakeFetch;

      const payload: AnalyzePayload = { videoId: 'v2' };
      await (consumer as any).handle(
        { ...mockJob, videoId: 'v2' },
        payload,
        mockCtx,
      );

      expect(mockPrisma.reframePlan.upsert).toHaveBeenCalledWith({
        where: { videoId: 'v2' },
        create: expect.objectContaining({
          videoId: 'v2',
          contentType: 'PODCAST',
          faces: expect.arrayContaining([
            expect.objectContaining({ label: 'speaker_left' }),
            expect.objectContaining({ label: 'speaker_right' }),
          ]),
        }),
        update: expect.anything(),
      });

      // Updated transcript segments with speaker labels
      expect(mockPrisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-1' },
        data: { speaker: 'speaker_0' },
      });
      expect(mockPrisma.transcriptSegment.update).toHaveBeenCalledWith({
        where: { id: 'seg-2' },
        data: { speaker: 'speaker_1' },
      });

      expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);
    });

    it('uses safe fallback when analyzer HTTP service is unreachable', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockSoloVideo);

      // Fetch rejects with network error
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('Connection refused'));

      const payload: AnalyzePayload = { videoId: 'v1' };
      await (consumer as any).handle(mockJob, payload, mockCtx);

      // Warning logged about fallback
      expect(mockCtx.logEvent).toHaveBeenCalledWith(
        'WARN',
        expect.stringContaining('Using built-in safe fallback'),
      );

      // ReframePlan still upserted safely
      expect(mockPrisma.reframePlan.upsert).toHaveBeenCalledWith({
        where: { videoId: 'v1' },
        create: expect.objectContaining({
          videoId: 'v1',
          contentType: 'SOLO',
        }),
        update: expect.anything(),
      });

      expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);
    });
  });
});
