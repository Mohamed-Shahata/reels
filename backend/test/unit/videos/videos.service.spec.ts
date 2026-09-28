import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import {
  type StorageService,
  UploadAssetNotReadyError,
} from '../../../src/storage/storage.service';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import { VideosService } from '../../../src/videos/videos.service';

const noopJobsService: ProcessingJobsService = {
  createJob: jest.fn().mockResolvedValue({ id: 'job-1', status: 'PENDING' }),
} as unknown as ProcessingJobsService;

describe('VideosService.createUpload', () => {
  it('creates an uploading video and scopes the signed public id to its owner', async () => {
    const video = {
      create: jest.fn().mockResolvedValue({
        id: 'video-1',
        title: 'Episode 42',
        status: 'UPLOADING',
        createdAt: new Date('2026-09-28T10:00:00.000Z'),
      }),
    };
    const storage = {
      createUploadSignature: jest.fn().mockReturnValue({
        publicId: 'podcast-reels/uploads/user-1/video-1',
        signature: 'signature',
      }),
      getVideoPublicId: jest
        .fn()
        .mockReturnValue('podcast-reels/uploads/user-1/video-1'),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
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
    expect(storage.createUploadSignature).toHaveBeenCalledWith({
      publicId: 'podcast-reels/uploads/user-1/video-1',
    });
    expect(result.video.status).toBe('UPLOADING');
    expect(result.upload.publicId).toBe('podcast-reels/uploads/user-1/video-1');
  });
});

describe('VideosService.getUploadConstraints', () => {
  it('returns the configured storage constraints without creating a video', () => {
    const storage = {
      getUploadConstraints: jest.fn().mockReturnValue({
        allowedFormats: ['mp4'],
        maxFileSizeBytes: 100,
        maxDurationSec: 60,
      }),
    };
    const service = new VideosService(
      {} as PrismaService,
      storage as unknown as StorageService,
      noopJobsService,
    );

    expect(service.getUploadConstraints()).toEqual({
      allowedFormats: ['mp4'],
      maxFileSizeBytes: 100,
      maxDurationSec: 60,
    });
    expect(storage.getUploadConstraints).toHaveBeenCalledTimes(1);
  });
});

describe('VideosService.library', () => {
  it('lists only the current user videos and serializes bigint sizes', async () => {
    const video = {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'video-1',
          title: 'Episode 42',
          cloudinaryId: 'videos/user-1/video-1',
          durationSec: 64.5,
          sizeBytes: 123456n,
          status: 'READY',
          createdAt: new Date('2026-09-28T10:00:00.000Z'),
        },
      ]),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      {} as StorageService,
      noopJobsService,
    );

    await expect(service.list('user-1')).resolves.toEqual([
      expect.objectContaining({ sizeBytes: '123456', status: 'READY' }),
    ]);
    expect(video.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        cloudinaryId: true,
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
        cloudinaryId: null,
        durationSec: null,
        sizeBytes: null,
        status: 'UPLOADING',
        createdAt: new Date('2026-09-28T10:00:00.000Z'),
      }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      {} as StorageService,
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

  it('removes the Cloudinary asset before deleting an owned video', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'video-1',
        cloudinaryId: 'videos/user-1/video-1',
      }),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const storage = { deleteVideo: jest.fn().mockResolvedValue(undefined) };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
      noopJobsService,
    );

    await expect(service.remove('user-1', 'video-1')).resolves.toBeUndefined();
    expect(storage.deleteVideo).toHaveBeenCalledWith('videos/user-1/video-1');
    expect(video.delete).toHaveBeenCalledWith({ where: { id: 'video-1' } });
  });

  it('does not delete an asset when the video is not owned by the user', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(null) };
    const storage = { deleteVideo: jest.fn() };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
      noopJobsService,
    );

    await expect(service.remove('user-2', 'video-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.deleteVideo).not.toHaveBeenCalled();
  });
});

describe('VideosService.resumeUpload', () => {
  it('only signs an upload that is still owned by the requesting user', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const storage = {
      createUploadSignature: jest.fn().mockReturnValue({
        publicId: 'podcast-reels/uploads/user-1/video-1',
      }),
      getVideoPublicId: jest
        .fn()
        .mockReturnValue('podcast-reels/uploads/user-1/video-1'),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
      noopJobsService,
    );

    await expect(service.resumeUpload('user-1', 'video-1')).resolves.toEqual({
      publicId: 'podcast-reels/uploads/user-1/video-1',
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

  it('does not sign an upload owned by another user', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(null) };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      { createUploadSignature: jest.fn() } as unknown as StorageService,
      noopJobsService,
    );

    await expect(
      service.resumeUpload('user-2', 'video-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('VideosService.completeUpload', () => {
  it('marks a verified upload as ready and serializes its size safely', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
      update: jest.fn().mockResolvedValue({
        id: 'video-1',
        title: 'Episode 42',
        cloudinaryId: 'podcast-reels/uploads/user-1/video-1',
        durationSec: 64.5,
        sizeBytes: 123456n,
        status: 'READY',
      }),
    };
    const storage = {
      getVideoMetadata: jest.fn().mockResolvedValue({
        publicId: 'podcast-reels/uploads/user-1/video-1',
        durationSec: 64.5,
        bytes: 123456n,
      }),
      getVideoPublicId: jest
        .fn()
        .mockReturnValue('podcast-reels/uploads/user-1/video-1'),
      getLegacyVideoPublicIds: jest.fn().mockReturnValue([]),
    };
    const usageRecord = { upsert: jest.fn().mockResolvedValue(undefined) };
    const service = new VideosService(
      { video, usageRecord } as unknown as PrismaService,
      storage as unknown as StorageService,
      noopJobsService,
    );

    await expect(service.completeUpload('user-1', 'video-1')).resolves.toEqual(
      expect.objectContaining({
        cloudinaryId: 'podcast-reels/uploads/user-1/video-1',
        durationSec: 64.5,
        sizeBytes: '123456',
        status: 'READY',
      }),
    );
    expect(video.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          cloudinaryId: 'podcast-reels/uploads/user-1/video-1',
          durationSec: 64.5,
          sizeBytes: 123456n,
          status: 'READY',
        },
      }),
    );
  });

  it('marks the pending video as failed when Cloudinary cannot verify it', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const storage = {
      getVideoMetadata: jest.fn().mockRejectedValue(new Error('not found')),
      getVideoPublicId: jest
        .fn()
        .mockReturnValue('podcast-reels/uploads/user-1/video-1'),
      getLegacyVideoPublicIds: jest.fn().mockReturnValue([]),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
      noopJobsService,
    );

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(video.update).toHaveBeenCalledWith({
      where: { id: 'video-1' },
      data: { status: 'FAILED' },
    });
  });

  it('keeps the upload pending while Cloudinary is still indexing the asset', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
      update: jest.fn(),
    };
    const storage = {
      getVideoMetadata: jest
        .fn()
        .mockRejectedValue(new UploadAssetNotReadyError()),
      getVideoPublicId: jest
        .fn()
        .mockReturnValue('podcast-reels/uploads/user-1/video-1'),
      getLegacyVideoPublicIds: jest.fn().mockReturnValue([]),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
      noopJobsService,
    );

    await expect(
      service.completeUpload('user-1', 'video-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(video.update).not.toHaveBeenCalled();
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
      {} as StorageService,
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
      {} as StorageService,
      noopJobsService,
    );

    await expect(
      service.getTranscript('user-1', 'video-999'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
