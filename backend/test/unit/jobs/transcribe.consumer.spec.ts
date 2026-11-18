import {
  TranscribeConsumer,
  type TranscribePayload,
} from '../../../src/jobs/consumers/transcribe.consumer';
import {
  FatalJobError,
  RetryableJobError,
  JOB_ERROR_CODES,
} from '../../../src/jobs/errors/job.error';
import type {
  ProcessingJob,
  Video,
} from '../../../src/generated/prisma/client';
import type { JobExecutionContext } from '../../../src/jobs/base/base-job-consumer';
import { Readable } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('TranscribeConsumer', () => {
  let consumer: TranscribeConsumer;
  let mockPrisma: any;
  let mockRabbit: any;
  let mockS3: any;
  let mockMediaAssets: any;
  let mockJobsService: any;
  let mockTranscription: any;
  let mockConfig: any;
  let mockCtx: JobExecutionContext;
  let tempWorkDir: string;

  beforeEach(() => {
    tempWorkDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'reelcast-transcribe-'),
    );

    mockPrisma = {
      video: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      mediaAsset: {
        findFirst: jest.fn(),
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

    mockS3 = {
      head: jest.fn(),
      getObjectStream: jest.fn(),
      putObject: jest.fn().mockResolvedValue(undefined),
    };

    mockMediaAssets = {
      getAssetStream: jest.fn(),
    };

    mockJobsService = {
      enqueue: jest.fn().mockResolvedValue({ id: 'job-segment-1' }),
    };

    mockTranscription = {
      chunkAudio: jest.fn(),
      transcribeChunk: jest.fn(),
      mergeAndStore: jest.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'TRANSCRIBE_CONCURRENCY') return 2;
        return null;
      }),
    };

    mockCtx = {
      jobId: 'job-transcribe-1',
      videoId: 'v1',
      workDir: tempWorkDir,
      isCancelled: jest.fn().mockResolvedValue(false),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    consumer = new TranscribeConsumer(
      mockPrisma,
      mockRabbit,
      mockS3,
      mockMediaAssets,
      mockJobsService,
      mockTranscription,
      mockConfig,
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempWorkDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('has queue name "transcribe"', () => {
    expect(consumer.getQueueName()).toBe('transcribe');
  });

  describe('handle flow', () => {
    const mockJob: ProcessingJob = {
      id: 'job-transcribe-1',
      userId: 'u1',
      videoId: 'v1',
      type: 'TRANSCRIBE',
      status: 'RUNNING',
      attempt: 1,
      maxAttempts: 5,
      lockedBy: 'worker-1',
      heartbeatAt: new Date(),
      idempotencyKey: 'transcribe-v1',
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
      durationSec: 120,
      contentType: 'PODCAST',
      sizeBytes: BigInt(1024),
      autoClips: false,
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

    it('throws FatalJobError if audio media asset is missing', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);

      await expect(
        (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx),
      ).rejects.toThrow('Audio asset not found');
    });

    it('classifies 429 rate limit error as RetryableJobError with retryAfter', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/audio.mp3',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-mp3-audio')]),
      });

      mockTranscription.chunkAudio.mockResolvedValue([
        { filePath: '/tmp/chunk-0.mp3', startSec: 0, endSec: 60 },
      ]);

      mockS3.head.mockResolvedValue(null); // No checkpoint cached

      // Groq returns 429 rate limit
      const rateLimitErr = {
        status: 429,
        message: 'Rate limit reached',
        headers: { 'retry-after': '30' },
      };
      mockTranscription.transcribeChunk.mockRejectedValue(rateLimitErr);

      try {
        await (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx);
        fail('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(RetryableJobError);
        expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(err.details?.retryAfter).toBe('30');
      }
    });

    it('classifies 500 server error as RetryableJobError', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/audio.mp3',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-mp3-audio')]),
      });

      mockTranscription.chunkAudio.mockResolvedValue([
        { filePath: '/tmp/chunk-0.mp3', startSec: 0, endSec: 60 },
      ]);

      mockS3.head.mockResolvedValue(null);

      const serverErr = { status: 503, message: 'Service Unavailable' };
      mockTranscription.transcribeChunk.mockRejectedValue(serverErr);

      try {
        await (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx);
        fail('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(RetryableJobError);
        expect(err.code).toBe('TRANSCRIBE_SERVER_ERROR');
      }
    });

    it('classifies 401 client error as FatalJobError', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/audio.mp3',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-mp3-audio')]),
      });

      mockTranscription.chunkAudio.mockResolvedValue([
        { filePath: '/tmp/chunk-0.mp3', startSec: 0, endSec: 60 },
      ]);

      mockS3.head.mockResolvedValue(null);

      const clientErr = { status: 401, message: 'Invalid API Key' };
      mockTranscription.transcribeChunk.mockRejectedValue(clientErr);

      try {
        await (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx);
        fail('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(FatalJobError);
        expect(err.code).toBe(JOB_ERROR_CODES.TRANSCRIBE_FAILED);
      }
    });

    it('resumes from checkpoint: skips cached chunks and only transcribes missing chunk', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/audio.mp3',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-mp3-audio')]),
      });

      // 2 chunks total
      const chunks = [
        { filePath: '/tmp/chunk-0.mp3', startSec: 0, endSec: 600 },
        { filePath: '/tmp/chunk-1.mp3', startSec: 590, endSec: 800 },
      ];
      mockTranscription.chunkAudio.mockResolvedValue(chunks);

      const cachedChunk0Segments = [
        { start: 0, end: 10, text: 'Cached chunk 0' },
      ];
      const freshChunk1Segments = [
        { start: 0, end: 15, text: 'Fresh chunk 1' },
      ];

      // Chunk 0 has checkpoint, chunk 1 does not
      mockS3.head.mockImplementation(async (key: string) => {
        if (key.includes('chunk-0.json')) return { contentLength: 100 };
        return null;
      });

      mockS3.getObjectStream.mockImplementation(async (key: string) => {
        if (key.includes('chunk-0.json')) {
          return Readable.from([
            Buffer.from(JSON.stringify(cachedChunk0Segments)),
          ]);
        }
        throw new Error('Not found');
      });

      mockTranscription.transcribeChunk.mockResolvedValue(freshChunk1Segments);

      const payload: TranscribePayload = { videoId: 'v1', language: 'ar' };
      await (consumer as any).handle(mockJob, payload, mockCtx);

      // transcribeChunk called only ONCE (for chunk 1)
      expect(mockTranscription.transcribeChunk).toHaveBeenCalledTimes(1);
      expect(mockTranscription.transcribeChunk).toHaveBeenCalledWith(
        chunks[1],
        'ar',
      );

      // Checkpoint written only for chunk 1
      expect(mockS3.putObject).toHaveBeenCalledWith(
        'users/u1/videos/v1/transcripts/chunk-1.json',
        expect.anything(),
        'application/json',
      );

      // mergeAndStore called with both cached and fresh segments
      expect(mockTranscription.mergeAndStore).toHaveBeenCalledWith(
        'v1',
        chunks,
        [cachedChunk0Segments, freshChunk1Segments],
        'ar',
      );

      // Enqueues SEGMENT in outbox
      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          type: 'SEGMENT',
          payload: { videoId: 'v1' },
        }),
      );
    });

    it('successfully processes full audio, checkpoints all chunks, and enqueues SEGMENT', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/audio.mp3',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-mp3-audio')]),
      });

      const chunks = [
        { filePath: '/tmp/chunk-0.mp3', startSec: 0, endSec: 60 },
      ];
      mockTranscription.chunkAudio.mockResolvedValue(chunks);

      mockS3.head.mockResolvedValue(null);

      const segments = [
        { start: 0, end: 5, text: 'مرحبا بكم في بودكاست جديد' },
      ];
      mockTranscription.transcribeChunk.mockResolvedValue(segments);

      await (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx);

      expect(mockS3.putObject).toHaveBeenCalledWith(
        'users/u1/videos/v1/transcripts/chunk-0.json',
        expect.anything(),
        'application/json',
      );

      expect(mockTranscription.mergeAndStore).toHaveBeenCalledWith(
        'v1',
        chunks,
        [segments],
        'ar',
      );

      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          type: 'SEGMENT',
          payload: { videoId: 'v1' },
        }),
      );
    });
  });
});
