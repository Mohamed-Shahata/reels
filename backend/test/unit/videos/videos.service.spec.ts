import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import { VideosService } from '../../../src/videos/videos.service';

const noopJobsService: ProcessingJobsService = {
  createJob: jest.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' }),
  enqueue: jest.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' }),
} as unknown as ProcessingJobsService;

describe('VideosService.createUpload', () => {
  it('creates an uploading video and returns upload storageKey', async () => {
    const video = {
      create: jest.fn().mockResolvedValue({
        id: 'video-1',
        title: 'Episode 42',
        status: 'UPLOADING',
        createdAt: new Date('2026-09-28T10:00:00.000Z'),
      }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    const result = await service.createUpload('user-1', 'Episode 42');

    expect(video.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', title: 'Episode 42' },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
      },
    });
    expect(result.video.status).toBe('UPLOADING');
    expect(result.upload.storageKey).toBe(
      'users/user-1/videos/video-1/source.mp4',
    );
  });
});

describe('VideosService.getUploadConstraints', () => {
  it('returns the configured storage constraints without creating a video', () => {
    const service = new VideosService({} as PrismaService, noopJobsService);

    expect(service.getUploadConstraints()).toEqual({
      allowedFormats: ['mp4', 'mov', 'webm', 'mkv'],
      maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
      maxDurationSec: 14400,
    });
  });
});

describe('VideosService.library', () => {
  it('lists only the current user videos and serializes bigint sizes', async () => {
    const video = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'video-1',
          title: 'Episode 42',
          durationSec: 64.5,
          sizeBytes: 123456n,
          status: 'READY',
          createdAt: new Date('2026-09-28T10:00:00.000Z'),
        },
      ]),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(service.list('user-1')).resolves.toEqual([
      expect.objectContaining({ sizeBytes: '123456', status: 'READY' }),
    ]);
    expect(video.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null, status: { not: 'DELETING' } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        durationSec: true,
        sizeBytes: true,
        status: true,
        createdAt: true,
      },
    });
  });

  it('renames only a video owned by the current user', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
      update: jest.fn().mockResolvedValue({
        id: 'video-1',
        title: 'New title',
        durationSec: null,
        sizeBytes: null,
        status: 'UPLOADING',
        createdAt: new Date('2026-09-28T10:00:00.000Z'),
      }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(
      service.rename('user-1', 'video-1', 'New title'),
    ).resolves.toEqual(expect.objectContaining({ title: 'New title' }));
    expect(video.findFirst).toHaveBeenCalledWith({
      where: { id: 'video-1', userId: 'user-1' },
      select: { id: true },
    });
  });

  it('soft deletes an owned video and cancels active jobs in a transaction', async () => {
    const mockTx = {
      video: { update: jest.fn().mockResolvedValue(undefined) },
      processingJob: { updateMany: jest.fn().mockResolvedValue(undefined) },
      mediaAsset: { updateMany: jest.fn().mockResolvedValue(undefined) },
    };
    const prisma = {
      video: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'video-1', userId: 'user-1' }),
      },
      $transaction: jest.fn((cb) => cb(mockTx)),
    };
    const service = new VideosService(
      prisma as unknown as PrismaService,
      noopJobsService,
    );

    await expect(service.remove('user-1', 'video-1')).resolves.toBeUndefined();
    expect(mockTx.video.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'video-1' },
        data: expect.objectContaining({ status: 'DELETING' }),
      }),
    );
  });

  it('does not delete when the video is not owned by the user', async () => {
    const prisma = {
      video: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new VideosService(
      prisma as unknown as PrismaService,
      noopJobsService,
    );

    await expect(service.remove('user-2', 'video-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('VideosService.resumeUpload', () => {
  it('only resumes an upload that is still owned by the requesting user', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(service.resumeUpload('user-1', 'video-1')).resolves.toEqual({
      videoId: 'video-1',
    });
    expect(video.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'video-1',
        userId: 'user-1',
        status: { in: ['UPLOADING', 'FAILED'] },
      },
      select: { id: true },
    });
  });

  it('does not resume an upload owned by another user', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(null) };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(
      service.resumeUpload('user-2', 'video-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VideosService.completeUpload', () => {
  it('returns already ready video directly', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'video-1',
        title: 'Episode 42',
        durationSec: 64.5,
        sizeBytes: 123456n,
        status: 'READY',
      }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(service.completeUpload('user-1', 'video-1')).resolves.toEqual(
      expect.objectContaining({
        durationSec: 64.5,
        sizeBytes: '123456',
        status: 'READY',
      }),
    );
  });

  it('throws BadRequestException when upload cannot be completed', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'video-1',
        status: 'UPLOADING',
      }),
    };
    const service = new VideosService(
      {
        video,
        mediaAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('VideosService.getTranscript', () => {
  it('returns the transcript for an owned video', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
    };
    const transcript = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'transcript-1',
        videoId: 'video-1',
        language: 'ar',
        segments: [{ id: 'seg-1', startSec: 0, endSec: 5, text: 'مرحبا بكم' }],
      }),
    };
    const service = new VideosService(
      { video, transcript } as unknown as PrismaService,
      noopJobsService,
    );

    const result = await service.getTranscript('user-1', 'video-1');

    expect(result).toEqual({
      id: 'transcript-1',
      videoId: 'video-1',
      language: 'ar',
      segments: [{ id: 'seg-1', startSec: 0, endSec: 5, text: 'مرحبا بكم' }],
    });
    expect(video.findFirst).toHaveBeenCalledWith({
      where: { id: 'video-1', userId: 'user-1' },
      select: { id: true },
    });
    expect(transcript.findUnique).toHaveBeenCalledWith({
      where: { videoId: 'video-1' },
      include: {
        segments: {
          orderBy: { startSec: 'asc' },
          select: {
            id: true,
            startSec: true,
            endSec: true,
            text: true,
            speaker: true,
          },
        },
      },
    });
  });

  it('throws NotFoundException if video is not found or not owned', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(
      service.getTranscript('user-1', 'video-999'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VideosService.exportTranscript', () => {
  const mockVideo = { id: 'video-1', title: 'بودكاست حوار' };
  const mockSegments = [
    {
      id: 'seg-1',
      startSec: 1.5,
      endSec: 4.25,
      text: 'أهلاً بكم في الحلقة',
      speaker: 'محمد',
    },
    {
      id: 'seg-2',
      startSec: 5.0,
      endSec: 8.1,
      text: 'شكراً جزيلاً',
      speaker: 'علي',
    },
  ];

  it('exports SRT with valid sequence numbering, timestamps, and BOM', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(mockVideo) };
    const transcript = {
      findUnique: jest.fn().mockResolvedValue({
        id: 't-1',
        segments: mockSegments,
      }),
    };

    const service = new VideosService(
      { video, transcript } as unknown as PrismaService,
      noopJobsService,
    );

    const { content, filename, contentType } = await service.exportTranscript(
      'user-1',
      'video-1',
      'srt',
    );

    expect(contentType).toBe('application/x-subrip; charset=utf-8');
    expect(filename).toBe('بودكاست حوار.srt');
    expect(content.startsWith('\ufeff')).toBe(true);
    expect(content).toContain(
      '1\n00:00:01,500 --> 00:00:04,250\n[محمد]: أهلاً بكم في الحلقة',
    );
    expect(content).toContain(
      '2\n00:00:05,000 --> 00:00:08,100\n[علي]: شكراً جزيلاً',
    );
  });

  it('exports VTT with WEBVTT header and speaker voice tags', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(mockVideo) };
    const transcript = {
      findUnique: jest.fn().mockResolvedValue({
        id: 't-1',
        segments: mockSegments,
      }),
    };

    const service = new VideosService(
      { video, transcript } as unknown as PrismaService,
      noopJobsService,
    );

    const { content, filename, contentType } = await service.exportTranscript(
      'user-1',
      'video-1',
      'vtt',
    );

    expect(contentType).toBe('text/vtt; charset=utf-8');
    expect(filename).toBe('بودكاست حوار.vtt');
    expect(content).toContain('WEBVTT\n\n');
    expect(content).toContain(
      '00:00:01.500 --> 00:00:04.250\n<v محمد>أهلاً بكم في الحلقة',
    );
  });

  it('exports TXT with plain text lines', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(mockVideo) };
    const transcript = {
      findUnique: jest.fn().mockResolvedValue({
        id: 't-1',
        segments: mockSegments,
      }),
    };

    const service = new VideosService(
      { video, transcript } as unknown as PrismaService,
      noopJobsService,
    );

    const { content, filename, contentType } = await service.exportTranscript(
      'user-1',
      'video-1',
      'txt',
    );

    expect(contentType).toBe('text/plain; charset=utf-8');
    expect(filename).toBe('بودكاست حوار.txt');
    expect(content).toContain('[محمد] أهلاً بكم في الحلقة\n[علي] شكراً جزيلاً');
  });

  it('throws NotFoundException when transcript has no segments', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(mockVideo) };
    const transcript = {
      findUnique: jest.fn().mockResolvedValue({
        id: 't-1',
        segments: [],
      }),
    };

    const service = new VideosService(
      { video, transcript } as unknown as PrismaService,
      noopJobsService,
    );

    await expect(
      service.exportTranscript('user-1', 'video-1', 'srt'),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('VideosService.listLibrary', () => {
  it('summarises clips, reels, transcript state and thumbnails per video', async () => {
    const base = {
      durationSec: null,
      sizeBytes: null,
      createdAt: new Date('2026-09-28T10:00:00.000Z'),
    };
    const video = {
      findMany: jest.fn().mockResolvedValue([
        {
          ...base,
          id: 'v-ready',
          title: 'Ready',
          durationSec: 120,
          sizeBytes: 10n,
          status: 'READY',
          transcript: { id: 't-1' },
          clips: [
            {
              renders: [{ outputUrl: 'https://x/1.mp4' }, { outputUrl: null }],
            },
            { renders: [{ outputUrl: 'https://x/2.mp4' }] },
            { renders: [] },
          ],
          processingJobs: [
            { status: 'COMPLETED', progress: 100, lastError: null },
          ],
        },
        {
          ...base,
          id: 'v-failed',
          title: 'Failed',
          status: 'FAILED',
          transcript: null,
          clips: [],
          processingJobs: [],
        },
        {
          ...base,
          id: 'v-transcribing',
          title: 'Transcribing',
          durationSec: 60,
          status: 'READY',
          transcript: null,
          clips: [],
          processingJobs: [
            { status: 'RUNNING', progress: 40, lastError: null },
          ],
        },
      ]),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    const result = await service.listLibrary('user-1');

    expect(result[0]).toMatchObject({
      id: 'v-ready',
      clipCount: 3,
      reelCount: 2,
      transcriptReady: true,
      transcriptionState: 'COMPLETED',
      thumbnailUrl: '/api/v1/videos/v-ready/thumbnail',
      failureReason: null,
    });
    expect(result[1]).toMatchObject({
      id: 'v-failed',
      thumbnailUrl: null,
      transcriptionState: 'NONE',
    });
    expect(result[1].failureReason).toContain('Retry');
    expect(result[2]).toMatchObject({
      transcriptReady: false,
      transcriptionState: 'RUNNING',
      transcriptionProgress: 40,
    });
  });
});

describe('VideosService language options', () => {
  it('stores the chosen language and auto clip option on create', async () => {
    const video = {
      create: jest.fn().mockResolvedValue({
        id: 'video-1',
        title: 'Episode',
        status: 'UPLOADING',
        createdAt: new Date(),
      }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      noopJobsService,
    );

    await service.createUpload('user-1', 'Episode', {
      language: 'en',
      autoClips: true,
    });

    expect(video.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'user-1',
          title: 'Episode',
          language: 'en',
          autoClips: true,
        },
      }),
    );
  });

  it('transcribes with the language saved on the video', async () => {
    const createJob = jest.fn().mockResolvedValue({ id: 'job-1' });
    const service = new VideosService(
      {
        video: {
          findFirst: jest
            .fn()
            .mockResolvedValue({ id: 'video-1', language: 'en' }),
        },
      } as unknown as PrismaService,
      { createJob } as unknown as ProcessingJobsService,
    );

    await service.startTranscription('user-1', 'video-1');

    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { language: 'en' } }),
    );
  });

  describe('S3 Multipart Upload Flows', () => {
    let mockPrisma: any;
    let mockS3: any;
    let mockMediaAssets: any;
    let mockJobsService: any;
    let service: VideosService;

    beforeEach(() => {
      mockPrisma = {
        video: {
          create: jest.fn().mockResolvedValue({
            id: 'v-s3-1',
            title: 'S3 Video',
            status: 'UPLOADING',
            createdAt: new Date(),
          }),
          findFirst: jest.fn(),
          update: jest.fn(),
        },
        mediaAsset: {
          findFirst: jest.fn(),
        },
        $transaction: jest.fn((cb) => cb(mockPrisma)),
      };

      mockS3 = {
        createMultipart: jest.fn().mockResolvedValue({ uploadId: 'up-s3-999' }),
        presignPart: jest
          .fn()
          .mockImplementation(
            (_key, _upId, partNum) => `https://s3.example.com/part/${partNum}`,
          ),
        listParts: jest.fn().mockResolvedValue([
          { partNumber: 1, etag: 'etag-1', size: 5000000 },
          { partNumber: 2, etag: 'etag-2', size: 3000000 },
        ]),
        completeMultipart: jest
          .fn()
          .mockResolvedValue({ location: 'https://s3' }),
        head: jest.fn().mockResolvedValue({
          contentLength: 8000000,
          contentType: 'video/mp4',
        }),
        findActiveMultipartUpload: jest.fn().mockResolvedValue('up-s3-999'),
      };

      mockMediaAssets = {
        register: jest.fn().mockResolvedValue({ id: 'asset-s3-1' }),
        markReady: jest
          .fn()
          .mockResolvedValue({ id: 'asset-s3-1', status: 'READY' }),
      };

      mockJobsService = {
        enqueue: jest.fn().mockResolvedValue({ id: 'job-ingest-1' }),
      };

      service = new VideosService(
        mockPrisma,
        mockJobsService,
        mockS3,
        mockMediaAssets,
      );
    });

    it('creates upload with S3 multipart and MediaAsset registration', async () => {
      const res = await service.createUpload('user-1', 'S3 Video', {
        filename: 'my-podcast.mov',
        contentType: 'PODCAST',
        sizeBytes: 8000000,
      });

      expect(mockPrisma.video.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            title: 'S3 Video',
            contentType: 'PODCAST',
          }),
        }),
      );

      expect(mockS3.createMultipart).toHaveBeenCalledWith(
        'users/user-1/videos/v-s3-1/source.mov',
        'video/mp4',
      );

      expect(mockMediaAssets.register).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          userId: 'user-1',
          videoId: 'v-s3-1',
          kind: 'SOURCE',
          storageKey: 'users/user-1/videos/v-s3-1/source.mov',
        }),
      );

      expect(res.upload.uploadId).toBe('up-s3-999');
      expect((res.upload.parts as any[]).length).toBe(5);
    });

    it('rejects unsupported video format', async () => {
      await expect(
        service.createUpload('user-1', 'Bad Format', {
          filename: 'malicious.exe',
        }),
      ).rejects.toThrow('Unsupported video format');
    });

    it('rejects video exceeding maximum size', async () => {
      await expect(
        service.createUpload('user-1', 'Too Big', {
          sizeBytes: 6 * 1024 * 1024 * 1024,
        }),
      ).rejects.toThrow('Video file exceeds maximum allowed size');
    });

    it('returns upload status for resuming from S3', async () => {
      mockPrisma.video.findFirst.mockResolvedValue({
        id: 'v-1',
        status: 'UPLOADING',
      });
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/user-1/videos/v-1/source.mp4',
      });

      const status = await service.getUploadStatus(
        'user-1',
        'v-1',
        'up-s3-999',
      );

      expect(status.uploadId).toBe('up-s3-999');
      expect(status.parts).toEqual([
        { partNumber: 1, eTag: 'etag-1', size: 5000000 },
        { partNumber: 2, eTag: 'etag-2', size: 3000000 },
      ]);
    });

    it('presigns batch of parts', async () => {
      mockPrisma.video.findFirst.mockResolvedValue({ id: 'v-1' });
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        storageKey: 'users/user-1/videos/v-1/source.mp4',
      });

      const res = await service.presignParts(
        'user-1',
        'v-1',
        'up-s3-999',
        [3, 4],
      );

      expect(res.parts).toEqual([
        { partNumber: 3, url: 'https://s3.example.com/part/3' },
        { partNumber: 4, url: 'https://s3.example.com/part/4' },
      ]);
    });

    it('completes S3 multipart upload and enqueues INGEST job transactionally', async () => {
      mockPrisma.video.findFirst.mockResolvedValue({
        id: 'v-1',
        title: 'Episode',
        status: 'UPLOADING',
      });
      mockPrisma.mediaAsset.findFirst.mockResolvedValue({
        id: 'asset-1',
        storageKey: 'users/user-1/videos/v-1/source.mp4',
      });
      mockPrisma.video.update.mockResolvedValue({
        id: 'v-1',
        title: 'Episode',
        durationSec: 0,
        sizeBytes: BigInt(8000000),
        status: 'READY',
      });

      const res = await service.completeUpload('user-1', 'v-1', {
        uploadId: 'up-s3-999',
        parts: [
          { partNumber: 1, eTag: 'etag-1' },
          { partNumber: 2, eTag: 'etag-2' },
        ],
      });

      expect(mockS3.completeMultipart).toHaveBeenCalledWith(
        'users/user-1/videos/v-1/source.mp4',
        'up-s3-999',
        [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 2, etag: 'etag-2' },
        ],
      );

      expect(mockS3.head).toHaveBeenCalledWith(
        'users/user-1/videos/v-1/source.mp4',
      );

      expect(mockMediaAssets.markReady).toHaveBeenCalledWith(
        mockPrisma,
        'asset-1',
        expect.objectContaining({ sizeBytes: 8000000 }),
      );

      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          userId: 'user-1',
          videoId: 'v-1',
          type: 'INGEST',
          payload: { storageKey: 'users/user-1/videos/v-1/source.mp4' },
        }),
      );

      expect(res.status).toBe('READY');
      expect(res.sizeBytes).toBe('8000000');
    });
  });

  describe('findOne', () => {
    it('returns video with aggregated pipeline stepper array', async () => {
      const mockPrisma: any = {
        video: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'v-1',
            userId: 'user-1',
            title: 'My Video',
            status: 'PROCESSING',
            sizeBytes: BigInt(5000000),
            mediaAssets: [],
            processingJobs: [
              {
                id: 'j-ingest',
                type: 'INGEST',
                status: 'COMPLETED',
                progress: 100,
                errorCode: null,
                lastError: null,
              },
              {
                id: 'j-transcribe',
                type: 'TRANSCRIBE',
                status: 'RUNNING',
                progress: 45,
                errorCode: null,
                lastError: null,
              },
            ],
          }),
        },
      };

      const service = new VideosService(mockPrisma, noopJobsService);

      const res = await service.findOne('user-1', 'v-1');
      expect(res.id).toBe('v-1');
      expect(res.pipeline).toHaveLength(4);
      expect(res.pipeline[0]).toEqual({
        stage: 'INGEST',
        status: 'COMPLETED',
        progress: 100,
        errorCode: null,
      });
      expect(res.pipeline[1]).toEqual({
        stage: 'TRANSCRIBE',
        status: 'RUNNING',
        progress: 45,
        errorCode: null,
      });
      expect(res.pipeline[2]).toEqual({
        stage: 'SEGMENT',
        status: 'PENDING',
        progress: 0,
        errorCode: null,
      });
      expect(res.pipeline[3]).toEqual({
        stage: 'ANALYZE',
        status: 'PENDING',
        progress: 0,
        errorCode: null,
      });
    });

    it('throws NotFoundException when video does not exist', async () => {
      const mockPrisma: any = {
        video: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      const service = new VideosService(mockPrisma, noopJobsService);

      await expect(service.findOne('user-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('VideosService.getReframePlan', () => {
    it('returns reframe plan when found', async () => {
      const mockPrisma: any = {
        video: {
          findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }),
        },
        reframePlan: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'plan-1',
            videoId: 'v-1',
            version: 1,
            contentType: 'SOLO',
            faces: [{ timestamp: 0, x: 0.5, y: 0.5, w: 0.3, h: 0.3 }],
            speakerTurns: null,
          }),
        },
      };

      const service = new VideosService(mockPrisma, noopJobsService);

      const plan = await service.getReframePlan('user-1', 'v-1');
      expect(plan.id).toBe('plan-1');
      expect(plan.videoId).toBe('v-1');
      expect(mockPrisma.reframePlan.findUnique).toHaveBeenCalledWith({
        where: { videoId: 'v-1' },
      });
    });

    it('throws NotFoundException when video is not found', async () => {
      const mockPrisma: any = {
        video: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
        reframePlan: {
          findUnique: jest.fn(),
        },
      };

      const service = new VideosService(mockPrisma, noopJobsService);

      await expect(
        service.getReframePlan('user-1', 'nonexistent'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.reframePlan.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when reframe plan does not exist', async () => {
      const mockPrisma: any = {
        video: {
          findFirst: jest.fn().mockResolvedValue({ id: 'v-1' }),
        },
        reframePlan: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      };

      const service = new VideosService(mockPrisma, noopJobsService);

      await expect(service.getReframePlan('user-1', 'v-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
