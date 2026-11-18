import {
  IngestConsumer,
  type IngestPayload,
} from '../../../src/jobs/consumers/ingest.consumer';
import {
  FatalJobError,
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

describe('IngestConsumer', () => {
  let consumer: IngestConsumer;
  let mockPrisma: any;
  let mockRabbit: any;
  let mockS3: any;
  let mockMediaAssets: any;
  let mockJobsService: any;
  let mockConfig: any;
  let mockCtx: JobExecutionContext;
  let tempWorkDir: string;

  beforeEach(() => {
    tempWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelcast-test-'));

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

    mockS3 = {};

    mockMediaAssets = {
      getAssetStream: jest.fn(),
      putAsset: jest.fn().mockImplementation(async (input: any) => {
        if (input.body && typeof input.body.on === 'function') {
          input.body.on('error', () => {});
          input.body.resume();
        }
      }),
    };

    mockJobsService = {
      enqueue: jest.fn(),
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'VIDEO_MAX_DURATION_SEC') return 7200; // 2 hours
        return null;
      }),
    };

    mockCtx = {
      jobId: 'job-ingest-1',
      videoId: 'v1',
      workDir: tempWorkDir,
      isCancelled: jest.fn().mockResolvedValue(false),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      heartbeat: jest.fn().mockResolvedValue(undefined),
    };

    consumer = new IngestConsumer(
      mockPrisma,
      mockRabbit,
      mockS3,
      mockMediaAssets,
      mockJobsService,
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

  it('has queue name "ingest"', () => {
    expect(consumer.getQueueName()).toBe('ingest');
  });

  describe('handle flow', () => {
    const mockJob: ProcessingJob = {
      id: 'job-ingest-1',
      userId: 'u1',
      videoId: 'v1',
      type: 'INGEST',
      status: 'RUNNING',
      attempt: 1,
      maxAttempts: 3,
      lockedBy: 'worker-1',
      heartbeatAt: new Date(),
      idempotencyKey: 'ingest-v1',
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
      status: 'UPLOADING',
      durationSec: 0,
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

    it('throws FatalJobError if video not found in DB', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(null);
      await expect(
        (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx),
      ).rejects.toThrow('Video v1 was not found');
    });

    it('throws FatalJobError if source storage key is not found', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue(null);

      await expect(
        (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx),
      ).rejects.toThrow('No source storage key found');
    });

    it('throws FatalJobError when video has no audio track', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/source.mp4',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-video-bytes')]),
      });

      // Spy on probeMedia returning no audio streams
      jest.spyOn(consumer as any, 'probeMedia').mockResolvedValue({
        streams: [{ codec_type: 'video', codec_name: 'h264', duration: '60' }],
        format: { duration: '60' },
      });

      await expect(
        (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx),
      ).rejects.toThrow(FatalJobError);

      try {
        await (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx);
      } catch (err: any) {
        expect(err.code).toBe(JOB_ERROR_CODES.NO_AUDIO_TRACK);
      }
    });

    it('throws FatalJobError when duration exceeds max allowed duration', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/source.mp4',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-video-bytes')]),
      });

      // Spy on probeMedia returning 10,000s (> 7200s limit)
      jest.spyOn(consumer as any, 'probeMedia').mockResolvedValue({
        streams: [
          { codec_type: 'video', codec_name: 'h264', duration: '10000' },
          { codec_type: 'audio', codec_name: 'aac', duration: '10000' },
        ],
        format: { duration: '10000' },
      });

      try {
        await (consumer as any).handle(mockJob, { videoId: 'v1' }, mockCtx);
      } catch (err: any) {
        expect(err.code).toBe(JOB_ERROR_CODES.DURATION_EXCEEDED);
      }
    });

    it('successfully processes video, extracts audio, poster, proxy, and enqueues TRANSCRIBE', async () => {
      mockPrisma.video.findUnique.mockResolvedValue(mockVideo);
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/u1/videos/v1/source.mp4',
      });

      mockMediaAssets.getAssetStream.mockResolvedValue({
        stream: Readable.from([Buffer.from('fake-video-data')]),
      });

      // Spy probeMedia
      jest.spyOn(consumer as any, 'probeMedia').mockResolvedValue({
        streams: [
          { codec_type: 'video', codec_name: 'h264', duration: '120.5' },
          { codec_type: 'audio', codec_name: 'aac', duration: '120.5' },
        ],
        format: { duration: '120.5' },
      });

      // Spy runFfmpeg to avoid needing real ffmpeg in unit test
      // and create fake output files that handle() will read
      jest
        .spyOn(consumer as any, 'runFfmpeg')
        .mockImplementation(async (...allArgs: unknown[]) => {
          const args = allArgs[0] as string[];
          const outPath = args[args.length - 1];
          fs.writeFileSync(outPath, Buffer.from('fake-output-data'));
        });

      const payload: IngestPayload = { videoId: 'v1' };
      await (consumer as any).handle(mockJob, payload, mockCtx);

      // 1. Video set to PROCESSING
      expect(mockPrisma.video.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { status: 'PROCESSING' },
      });

      // 2. Video duration updated
      expect(mockPrisma.video.update).toHaveBeenCalledWith({
        where: { id: 'v1' },
        data: { durationSec: 120.5 },
      });

      // 3. Audio extracted and saved
      expect(mockMediaAssets.putAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          kind: 'AUDIO',
          contentType: 'audio/mpeg',
        }),
      );

      // 4. Poster extracted and saved
      expect(mockMediaAssets.putAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          kind: 'POSTER',
          contentType: 'image/jpeg',
        }),
      );

      // 5. Proxy generated and saved
      expect(mockMediaAssets.putAsset).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          kind: 'PROXY',
          contentType: 'video/mp4',
        }),
      );

      // 6. TRANSCRIBE job enqueued
      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v1',
          type: 'TRANSCRIBE',
          payload: {
            videoId: 'v1',
            language: 'ar',
          },
        }),
      );
    });
  });
});
