import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClipsService } from '../../../src/clips/clips.service';
import type { Env } from '../../../src/config/env.schema';
import type { PrismaService } from '../../../src/prisma/prisma.service';
function createService(
  prisma: Record<string, unknown>,
  mediaAssets?: any,
  jobsService?: any,
  ffmpegRender?: any,
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
    jobsService,
    mediaAssets,
    ffmpegRender,
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
      select: {
        id: true,
        status: true,
        durationSec: true,
      },
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

  it('creates validated AI suggestions with the AI source', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(readyVideo) };
    const record = (
      id: string,
      title: string,
      startSec: number,
      endSec: number,
    ) => ({
      id,
      videoId: 'video-1',
      title,
      startSec,
      endSec,
      source: 'AI' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const clip = {
      deleteMany: jest.fn(),
      createManyAndReturn: jest
        .fn()
        .mockResolvedValue([
          record('clip-2', 'Conclusion', 30, 60),
          record('clip-1', 'Introduction', 0, 30),
        ]),
    };
    const usageRecord = { upsert: jest.fn().mockResolvedValue(undefined) };
    const segmentationRun = { create: jest.fn().mockResolvedValue({}) };
    const transaction = { clip, usageRecord, segmentationRun };
    const service = new ClipsService(
      {
        video,
        clip,
        usageRecord,
        $transaction: jest.fn(
          (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
      } as unknown as PrismaService,
      {
        get: (key: 'CLIP_MIN_DURATION_SEC' | 'CLIP_MAX_DURATION_SEC') =>
          key === 'CLIP_MIN_DURATION_SEC' ? 5 : 180,
      } as ConfigService<Env, true>,
    );

    await expect(
      service.createAiSuggestions('user-1', 'video-1', [
        { title: 'Introduction', startSec: 0, endSec: 30, summary: 'Start.' },
        { title: 'Conclusion', startSec: 30, endSec: 60, summary: 'End.' },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'clip-1', source: 'AI' }),
      expect.objectContaining({ id: 'clip-2', source: 'AI' }),
    ]);
    expect(clip.createManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ source: 'AI' }),
          expect.objectContaining({ source: 'AI' }),
        ],
      }),
    );
    expect(usageRecord.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { clipCount: { increment: 2 } } }),
    );
    expect(segmentationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        videoId: 'video-1',
        clipCount: 2,
        replacedClipCount: 0,
        segments: [
          {
            title: 'Introduction',
            startSec: 0,
            endSec: 30,
            summary: 'Start.',
          },
          { title: 'Conclusion', startSec: 30, endSec: 60, summary: 'End.' },
        ],
      }) as unknown,
    });
    expect(clip.deleteMany).not.toHaveBeenCalled();
  });

  it('replaces only untouched AI clips and records the replacement in the stored run', async () => {
    const video = { findFirst: jest.fn().mockResolvedValue(readyVideo) };
    const clip = {
      deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
      createManyAndReturn: jest.fn().mockResolvedValue([
        {
          id: 'clip-9',
          videoId: 'video-1',
          title: 'Introduction',
          startSec: 0,
          endSec: 60,
          source: 'AI',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    };
    const usageRecord = { upsert: jest.fn().mockResolvedValue(undefined) };
    const segmentationRun = { create: jest.fn().mockResolvedValue({}) };
    const transaction = { clip, usageRecord, segmentationRun };
    const service = new ClipsService(
      {
        video,
        clip,
        usageRecord,
        $transaction: jest.fn(
          (callback: (client: typeof transaction) => Promise<unknown>) =>
            callback(transaction),
        ),
      } as unknown as PrismaService,
      {
        get: (key: 'CLIP_MIN_DURATION_SEC' | 'CLIP_MAX_DURATION_SEC') =>
          key === 'CLIP_MIN_DURATION_SEC' ? 5 : 180,
      } as ConfigService<Env, true>,
    );

    await service.createAiSuggestions(
      'user-1',
      'video-1',
      [{ title: 'Introduction', startSec: 0, endSec: 60, summary: 'Start.' }],
      { replaceExisting: true },
    );

    expect(clip.deleteMany).toHaveBeenCalledWith({
      where: { videoId: 'video-1', source: 'AI' },
    });
    expect(segmentationRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clipCount: 1,
        replacedClipCount: 4,
      }) as unknown,
    });
  });
});

describe('ClipsService AI run helpers', () => {
  it('counts AI clips only for an owned ready video', async () => {
    const clip = { count: jest.fn().mockResolvedValue(3) };

    await expect(
      createService({
        video: { findFirst: jest.fn().mockResolvedValue(readyVideo) },
        clip,
      }).countAiClips('user-1', 'video-1'),
    ).resolves.toBe(3);
    expect(clip.count).toHaveBeenCalledWith({
      where: { videoId: 'video-1', source: 'AI' },
    });

    await expect(
      createService({
        video: { findFirst: jest.fn().mockResolvedValue(null) },
        clip,
      }).countAiClips('user-2', 'video-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists stored AI runs newest first for the owner only', async () => {
    const segmentationRun = { findMany: jest.fn().mockResolvedValue([]) };

    await createService({
      video: { findFirst: jest.fn().mockResolvedValue(readyVideo) },
      segmentationRun,
    }).listAiRuns('user-1', 'video-1');

    expect(segmentationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { videoId: 'video-1', userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    await expect(
      createService({
        video: { findFirst: jest.fn().mockResolvedValue(null) },
        segmentationRun,
      }).listAiRuns('user-2', 'video-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
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
        video: { id: 'video-1' },
      }),
    };
    const mediaAsset = {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        if (where.clipId === 'clip-1') {
          return Promise.resolve({ storageKey: 'users/1/renders/r1.mp4' });
        }
        return Promise.resolve({ storageKey: 'users/1/proxies/p1.mp4' });
      }),
    };
    const mediaAssets = {
      signedUrl: jest
        .fn()
        .mockResolvedValue('https://signed.example/video.mp4'),
    };
    const service = createService({ clip, mediaAsset }, mediaAssets);

    await expect(service.getPlaybackUrl('user-1', 'clip-1')).resolves.toBe(
      'https://signed.example/video.mp4',
    );
    await expect(service.getDownloadUrl('user-1', 'clip-1')).resolves.toBe(
      'https://signed.example/video.mp4',
    );
    expect(mediaAssets.signedUrl).toHaveBeenCalledWith(
      'users/1/proxies/p1.mp4',
      3600,
    );
    expect(mediaAssets.signedUrl).toHaveBeenCalledWith(
      'users/1/renders/r1.mp4',
      300,
    );
  });

  it('throws NotFoundException when user does not own clip', async () => {
    const clip = { findFirst: jest.fn().mockResolvedValue(null) };
    const service = createService({ clip });

    await expect(
      service.getPlaybackUrl('user-2', 'clip-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getDownloadUrl('user-2', 'clip-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
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

  it('updates clip layout to STACKED', async () => {
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
        title: 'Original',
        startSec: 10,
        endSec: 30,
        layout: 'STACKED',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };

    await expect(
      createService({ clip }).update('user-1', 'clip-1', {
        layout: 'STACKED',
      }),
    ).resolves.toMatchObject({ id: 'clip-1', layout: 'STACKED' });
    expect(clip.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'clip-1' },
        data: expect.objectContaining({
          layout: 'STACKED',
          source: 'MANUAL',
        }),
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

describe('ClipsService thumbnail pipeline', () => {
  it('redirects to signedUrl when MediaAsset THUMB exists', async () => {
    const mediaAsset = {
      findFirst: jest.fn().mockResolvedValue({
        id: 'thumb-asset-1',
        kind: 'THUMB',
        status: 'READY',
      }),
    };
    const mockMediaAssets: any = {
      signedUrl: jest
        .fn()
        .mockResolvedValue('https://s3.example.com/signed-thumb.jpg'),
    };
    const res = { redirect: jest.fn() };

    const service = createService({ mediaAsset }, mockMediaAssets);

    await service.serveThumbnail(
      'clip-s3-1',
      res as unknown as import('express').Response,
    );

    expect(mockMediaAssets.signedUrl).toHaveBeenCalledWith(
      'thumb-asset-1',
      300,
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'https://s3.example.com/signed-thumb.jpg',
    );
  });

  it('throws NotFoundException if clip thumbnail was not found', async () => {
    const mediaAsset = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    const res = { redirect: jest.fn() };

    await expect(
      createService({ mediaAsset }, { signedUrl: jest.fn() }).serveThumbnail(
        'missing-clip',
        res as unknown as import('express').Response,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
