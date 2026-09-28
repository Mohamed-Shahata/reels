import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { StorageService } from '../../../src/storage/storage.service';
import { VideosService } from '../../../src/videos/videos.service';

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
        publicId: 'videos/user-1/video-1',
        signature: 'signature',
      }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
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
      publicId: 'videos/user-1/video-1',
    });
    expect(result.video.status).toBe('UPLOADING');
    expect(result.upload.publicId).toBe('videos/user-1/video-1');
  });
});

describe('VideosService.resumeUpload', () => {
  it('only signs an upload that is still owned by the requesting user', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }),
    };
    const storage = {
      createUploadSignature: jest.fn().mockReturnValue({
        publicId: 'videos/user-1/video-1',
      }),
    };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      storage as unknown as StorageService,
    );

    await expect(service.resumeUpload('user-1', 'video-1')).resolves.toEqual({
      publicId: 'videos/user-1/video-1',
    });
    expect(video.findFirst).toHaveBeenCalledWith({
      where: { id: 'video-1', userId: 'user-1', status: 'UPLOADING' },
      select: { id: true },
    });
  });

  it('does not sign an upload owned by another user', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(null) };
    const service = new VideosService(
      { video } as unknown as PrismaService,
      { createUploadSignature: jest.fn() } as unknown as StorageService,
    );

    await expect(
      service.resumeUpload('user-2', 'video-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
