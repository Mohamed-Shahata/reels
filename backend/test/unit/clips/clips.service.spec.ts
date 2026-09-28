import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClipsService } from '../../../src/clips/clips.service';
import type { Env } from '../../../src/config/env.schema';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { StorageService } from '../../../src/storage/storage.service';

function createService(
  prisma: Record<string, unknown>,
  storage: Partial<StorageService> = {},
): ClipsService {
  const values: Pick<Env, 'CLIP_MIN_DURATION_SEC' | 'CLIP_MAX_DURATION_SEC'> = {
    CLIP_MIN_DURATION_SEC: 5,
    CLIP_MAX_DURATION_SEC: 180,
  };
  const config = { get: (key: keyof typeof values) => values[key] };

  return new ClipsService(
    {
      usageRecord: { upsert: jest.fn().mockResolvedValue(undefined) },
      ...prisma,
    } as unknown as PrismaService,
    config as ConfigService<Env, true>,
    storage as StorageService,
  );
}

const readyVideo = { id: 'video-1', status: 'READY', durationSec: 120 };

describe('ClipsService.create', () => {
  it('creates a valid clip for an owned ready video', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(readyVideo) };
    const clip = {
      create: jest.fn().mockResolvedValue({
        id: 'clip-1',
        videoId: 'video-1',
        title: 'Key takeaway',
        startSec: 10,
        endSec: 30,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    const result = await createService({ video, clip }).create(
      'user-1',
      'video-1',
      { title: 'Key takeaway', startSec: 10, endSec: 30 },
    );

    expect(result).toMatchObject({ id: 'clip-1', startSec: 10, endSec: 30 });
    expect(video.findFirst).toHaveBeenCalledWith({
      where: { id: 'video-1', userId: 'user-1' },
      select: { id: true, status: true, durationSec: true },
    });
    expect(clip.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          videoId: 'video-1',
          title: 'Key takeaway',
          startSec: 10,
          endSec: 30,
        },
      }),
    );
  });

  it.each([
    ['a reversed range', 30, 10],
    ['a clip shorter than the minimum', 10, 14],
    ['a clip longer than the maximum', 0, 181],
    ['an end past the video duration', 100, 121],
  ])('rejects %s', async (_, startSec, endSec) => {
    const video = { findFirst: jest.fn().mockResolvedValue(readyVideo) };
    const clip = { create: jest.fn() };

    await expect(
      createService({ video, clip }).create('user-1', 'video-1', {
        title: 'Invalid range',
        startSec,
        endSec,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(clip.create).not.toHaveBeenCalled();
  });

  it('does not create clips until the video is ready', async () => {
    const video = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'video-1',
        status: 'UPLOADING',
        durationSec: null,
      }),
    };
    const clip = { create: jest.fn() };

    await expect(
      createService({ video, clip }).create('user-1', 'video-1', {
        title: 'Pending video',
        startSec: 10,
        endSec: 20,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(clip.create).not.toHaveBeenCalled();
  });
});

describe('ClipsService ownership and updates', () => {
  it('lists clips only after confirming ownership of the video', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(readyVideo) };
    const clip = { findMany: jest.fn().mockResolvedValue([]) };

    await expect(
      createService({ video, clip }).list('user-1', 'video-1'),
    ).resolves.toEqual([]);
    await expect(
      createService({
        video: { findFirst: jest.fn().mockResolvedValue(null) },
        clip,
      }).list('user-2', 'video-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('generates playback and streaming download URLs for an owned stored clip', async () => {
    const clip = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'clip-1',
        startSec: 10,
        endSec: 30,
        video: { cloudinaryId: 'podcast-reels/uploads/user-1/video-1' },
      }),
    };
    const storage = {
      getClipPlaybackUrl: jest.fn().mockReturnValue('https://preview.example'),
      getClipDownloadUrl: jest.fn().mockReturnValue('https://download.example'),
    };
    const service = createService({ clip }, storage);

    await expect(service.getPlaybackUrl('user-1', 'clip-1')).resolves.toBe(
      'https://preview.example',
    );
    await expect(service.getDownloadUrl('user-1', 'clip-1')).resolves.toBe(
      'https://download.example',
    );
    expect(storage.getClipPlaybackUrl).toHaveBeenCalledWith(
      'podcast-reels/uploads/user-1/video-1',
      10,
      30,
    );
    expect(storage.getClipDownloadUrl).toHaveBeenCalledWith(
      'podcast-reels/uploads/user-1/video-1',
      10,
      30,
      'clip-clip-1',
    );
  });

  it('revalidates the full range when a clip is updated', async () => {
    const clip = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'clip-1',
        title: 'Original',
        startSec: 10,
        endSec: 30,
        video: readyVideo,
      }),
      update: jest.fn().mockResolvedValue({
        id: 'clip-1',
        videoId: 'video-1',
        title: 'Updated',
        startSec: 10,
        endSec: 35,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    await expect(
      createService({ clip }).update('user-1', 'clip-1', {
        title: 'Updated',
        endSec: 35,
      }),
    ).resolves.toMatchObject({ title: 'Updated', endSec: 35 });
    expect(clip.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'clip-1', video: { is: { userId: 'user-1' } } },
      }),
    );
  });

  it('does not update or delete a clip owned by another user', async () => {
    const clip = {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const service = createService({ clip });

    await expect(
      service.update('user-2', 'clip-1', { title: 'Not allowed' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove('user-2', 'clip-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(clip.update).not.toHaveBeenCalled();
    expect(clip.delete).not.toHaveBeenCalled();
  });
});
