import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import type { StorageService } from '../../../src/storage/storage.service';
import type { SubtitlesService } from '../../../src/subtitles/subtitles.service';
import { RendersService } from '../../../src/renders/renders.service';

const readyClip = {
  id: 'clip-1',
  startSec: 10,
  endSec: 30,
  video: { id: 'video-1', status: 'READY', cloudinaryId: 'cloud/video-1' },
};

function renderRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-09-29T00:00:00.000Z');
  return {
    id: 'render-1',
    clipId: 'clip-1',
    startSec: 10,
    endSec: 30,
    outputUrl: null,
    createdAt: now,
    updatedAt: now,
    processingJob: {
      status: 'PENDING',
      progress: 0,
      attempts: 0,
      lastError: null,
    },
    ...overrides,
  };
}

function createService(
  prisma: Record<string, unknown>,
  jobs: Record<string, jest.Mock> = {},
  subtitles: Record<string, jest.Mock> = {},
  storage: Record<string, jest.Mock> = {},
) {
  return new RendersService(
    prisma as unknown as PrismaService,
    jobs as unknown as ProcessingJobsService,
    subtitles as unknown as SubtitlesService,
    storage as unknown as StorageService,
  );
}

describe('RendersService', () => {
  describe('create', () => {
    it('creates a render, queues a RENDER job and links them', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'render-1' }),
        update: jest.fn().mockResolvedValue(
          renderRecord({
            processingJob: {
              status: 'PENDING',
              progress: 0,
              attempts: 0,
              lastError: null,
            },
          }),
        ),
        delete: jest.fn(),
      };
      const clip = { findFirst: jest.fn().mockResolvedValue(readyClip) };
      const createJob = jest.fn().mockResolvedValue({ id: 'job-1' });
      const service = createService({ clip, clipRender }, { createJob });

      const result = await service.create('user-1', 'clip-1');

      expect(clip.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'clip-1', video: { is: { userId: 'user-1' } } },
        }),
      );
      expect(clipRender.create).toHaveBeenCalledWith({
        data: { clipId: 'clip-1', startSec: 10, endSec: 30 },
        select: { id: true },
      });
      expect(createJob).toHaveBeenCalledWith({
        userId: 'user-1',
        videoId: 'video-1',
        type: 'RENDER',
        payload: { clipRenderId: 'render-1' },
      });
      expect(clipRender.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'render-1' },
          data: { processingJobId: 'job-1' },
        }),
      );
      expect(result).toMatchObject({
        id: 'render-1',
        status: 'PENDING',
        progress: 0,
        error: null,
        outputUrl: null,
      });
    });

    it('creates the render row before the job so a worker can always find it', async () => {
      const order: string[] = [];
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(() => {
          order.push('render');
          return Promise.resolve({ id: 'render-1' });
        }),
        update: jest.fn().mockResolvedValue(renderRecord()),
        delete: jest.fn(),
      };
      const createJob = jest.fn(() => {
        order.push('job');
        return Promise.resolve({ id: 'job-1' });
      });
      const service = createService(
        {
          clip: { findFirst: jest.fn().mockResolvedValue(readyClip) },
          clipRender,
        },
        { createJob },
      );

      await service.create('user-1', 'clip-1');

      expect(order).toEqual(['render', 'job']);
    });

    it('returns the existing render for the same range instead of queueing another', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(
          renderRecord({
            outputUrl: 'https://reel.example',
            processingJob: {
              status: 'COMPLETED',
              progress: 100,
              attempts: 1,
              lastError: null,
            },
          }),
        ),
        create: jest.fn(),
      };
      const createJob = jest.fn();
      const service = createService(
        {
          clip: { findFirst: jest.fn().mockResolvedValue(readyClip) },
          clipRender,
        },
        { createJob },
      );

      await expect(service.create('user-1', 'clip-1')).resolves.toMatchObject({
        id: 'render-1',
        status: 'COMPLETED',
        outputUrl: 'https://reel.example',
      });
      expect(clipRender.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            startSec: 10,
            endSec: 30,
            processingJob: {
              is: { status: { in: ['PENDING', 'RUNNING', 'COMPLETED'] } },
            },
          }) as unknown,
        }),
      );
      expect(clipRender.create).not.toHaveBeenCalled();
      expect(createJob).not.toHaveBeenCalled();
    });

    it('rejects a clip the user does not own and queues nothing', async () => {
      const clipRender = { create: jest.fn() };
      const createJob = jest.fn();
      const service = createService(
        { clip: { findFirst: jest.fn().mockResolvedValue(null) }, clipRender },
        { createJob },
      );

      await expect(service.create('user-2', 'clip-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(clipRender.create).not.toHaveBeenCalled();
      expect(createJob).not.toHaveBeenCalled();
    });

    it('rejects clips whose video is not ready', async () => {
      const service = createService(
        {
          clip: {
            findFirst: jest.fn().mockResolvedValue({
              ...readyClip,
              video: { ...readyClip.video, status: 'UPLOADING' },
            }),
          },
        },
        { createJob: jest.fn() },
      );

      await expect(service.create('user-1', 'clip-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('removes the render row when the job cannot be queued', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'render-1' }),
        delete: jest.fn().mockResolvedValue(undefined),
        update: jest.fn(),
      };
      const service = createService(
        {
          clip: { findFirst: jest.fn().mockResolvedValue(readyClip) },
          clipRender,
        },
        { createJob: jest.fn().mockRejectedValue(new Error('redis down')) },
      );

      await expect(service.create('user-1', 'clip-1')).rejects.toThrow(
        'redis down',
      );
      expect(clipRender.delete).toHaveBeenCalledWith({
        where: { id: 'render-1' },
      });
      expect(clipRender.update).not.toHaveBeenCalled();
    });
  });

  describe('createForVideo', () => {
    const readyVideo = {
      id: 'video-1',
      status: 'READY',
      cloudinaryId: 'cloud/video-1',
      clips: [
        { id: 'clip-1', startSec: 10, endSec: 30 },
        { id: 'clip-2', startSec: 60, endSec: 90 },
      ],
    };

    it('queues one render per clip in timeline order', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'render-1' })
          .mockResolvedValueOnce({ id: 'render-2' }),
        update: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            renderRecord({
              id: where.id,
              clipId: where.id === 'render-1' ? 'clip-1' : 'clip-2',
            }),
          ),
        ),
        delete: jest.fn(),
      };
      const video = { findFirst: jest.fn().mockResolvedValue(readyVideo) };
      const createJob = jest
        .fn()
        .mockResolvedValueOnce({ id: 'job-1' })
        .mockResolvedValueOnce({ id: 'job-2' });
      const service = createService({ video, clipRender }, { createJob });

      const result = await service.createForVideo('user-1', 'video-1');

      expect(video.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'video-1', userId: 'user-1' } }),
      );
      expect(clipRender.create).toHaveBeenNthCalledWith(1, {
        data: { clipId: 'clip-1', startSec: 10, endSec: 30 },
        select: { id: true },
      });
      expect(clipRender.create).toHaveBeenNthCalledWith(2, {
        data: { clipId: 'clip-2', startSec: 60, endSec: 90 },
        select: { id: true },
      });
      expect(createJob).toHaveBeenCalledTimes(2);
      expect(createJob).toHaveBeenCalledWith(
        expect.objectContaining({ videoId: 'video-1', type: 'RENDER' }),
      );
      expect(result.map((render) => render.clipId)).toEqual([
        'clip-1',
        'clip-2',
      ]);
    });

    it('reuses renders that already exist for an unchanged range', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(
          renderRecord({
            outputUrl: 'https://reel.example',
            processingJob: {
              status: 'COMPLETED',
              progress: 100,
              attempts: 1,
              lastError: null,
            },
          }),
        ),
        create: jest.fn(),
      };
      const createJob = jest.fn();
      const service = createService(
        {
          video: { findFirst: jest.fn().mockResolvedValue(readyVideo) },
          clipRender,
        },
        { createJob },
      );

      const result = await service.createForVideo('user-1', 'video-1');

      expect(result).toHaveLength(2);
      expect(clipRender.create).not.toHaveBeenCalled();
      expect(createJob).not.toHaveBeenCalled();
    });

    it("never renders another user's video", async () => {
      const createJob = jest.fn();
      const service = createService(
        { video: { findFirst: jest.fn().mockResolvedValue(null) } },
        { createJob },
      );

      await expect(
        service.createForVideo('user-2', 'video-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(createJob).not.toHaveBeenCalled();
    });

    it('rejects videos that are not ready', async () => {
      const service = createService(
        {
          video: {
            findFirst: jest
              .fn()
              .mockResolvedValue({ ...readyVideo, status: 'UPLOADING' }),
          },
        },
        { createJob: jest.fn() },
      );

      await expect(
        service.createForVideo('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects videos without clips', async () => {
      const createJob = jest.fn();
      const service = createService(
        {
          video: {
            findFirst: jest
              .fn()
              .mockResolvedValue({ ...readyVideo, clips: [] }),
          },
        },
        { createJob },
      );

      await expect(
        service.createForVideo('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(createJob).not.toHaveBeenCalled();
    });

    it('stops and removes the pending row when a job cannot be queued', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'render-1' }),
        delete: jest.fn().mockResolvedValue(undefined),
        update: jest.fn(),
      };
      const service = createService(
        {
          video: { findFirst: jest.fn().mockResolvedValue(readyVideo) },
          clipRender,
        },
        { createJob: jest.fn().mockRejectedValue(new Error('redis down')) },
      );

      await expect(service.createForVideo('user-1', 'video-1')).rejects.toThrow(
        'redis down',
      );
      expect(clipRender.create).toHaveBeenCalledTimes(1);
      expect(clipRender.delete).toHaveBeenCalledWith({
        where: { id: 'render-1' },
      });
    });
  });

  describe('listForVideo', () => {
    it('returns the newest render of each clip for an owned video', async () => {
      const findMany = jest
        .fn()
        .mockResolvedValue([
          renderRecord({ id: 'render-2', clipId: 'clip-2' }),
          renderRecord({ id: 'render-1', clipId: 'clip-1' }),
        ]);
      const service = createService({
        video: { findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }) },
        clipRender: { findMany },
      });

      await expect(service.listForVideo('user-1', 'video-1')).resolves.toEqual([
        expect.objectContaining({ id: 'render-2', clipId: 'clip-2' }),
        expect.objectContaining({ id: 'render-1', clipId: 'clip-1' }),
      ]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clip: { is: { videoId: 'video-1' } } },
          orderBy: { createdAt: 'desc' },
          distinct: ['clipId', 'subtitleKey'],
        }),
      );
    });

    it("never lists another user's video renders", async () => {
      const findMany = jest.fn();
      const service = createService({
        video: { findFirst: jest.fn().mockResolvedValue(null) },
        clipRender: { findMany },
      });

      await expect(
        service.listForVideo('user-2', 'video-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns the newest renders of an owned clip with job status', async () => {
      const findMany = jest.fn().mockResolvedValue([
        renderRecord({
          id: 'render-2',
          processingJob: {
            status: 'FAILED',
            progress: 30,
            attempts: 1,
            lastError: 'Timed out waiting for the reel to render',
          },
        }),
      ]);
      const service = createService({
        clip: { findFirst: jest.fn().mockResolvedValue({ id: 'clip-1' }) },
        clipRender: { findMany },
      });

      await expect(service.list('user-1', 'clip-1')).resolves.toEqual([
        expect.objectContaining({
          id: 'render-2',
          status: 'FAILED',
          progress: 30,
          error: 'Timed out waiting for the reel to render',
        }),
      ]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clipId: 'clip-1' },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
      );
    });

    it("never lists another user's renders", async () => {
      const findMany = jest.fn();
      const service = createService({
        clip: { findFirst: jest.fn().mockResolvedValue(null) },
        clipRender: { findMany },
      });

      await expect(service.list('user-2', 'clip-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    const failedRender = {
      id: 'render-1',
      processingJobId: 'job-1',
      processingJob: { status: 'FAILED' },
      clip: { startSec: 12, endSec: 34 },
    };

    it('re-queues a failed render for the current clip range without a new upload', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(failedRender),
        update: jest.fn().mockResolvedValue(undefined),
        findFirstOrThrow: jest.fn().mockResolvedValue(
          renderRecord({
            startSec: 12,
            endSec: 34,
            processingJob: {
              status: 'PENDING',
              progress: 0,
              attempts: 1,
              lastError: null,
            },
          }),
        ),
      };
      const retryJob = jest.fn().mockResolvedValue({ id: 'job-1' });
      const service = createService({ clipRender }, { retryJob });

      const result = await service.retry('user-1', 'render-1');

      expect(clipRender.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'render-1',
            clip: { is: { video: { is: { userId: 'user-1' } } } },
          },
        }),
      );
      expect(clipRender.update).toHaveBeenCalledWith({
        where: { id: 'render-1' },
        data: { startSec: 12, endSec: 34, outputUrl: null },
      });
      expect(retryJob).toHaveBeenCalledWith('job-1');
      expect(result).toMatchObject({
        status: 'PENDING',
        startSec: 12,
        endSec: 34,
        error: null,
      });
    });

    it.each(['PENDING', 'RUNNING', 'COMPLETED'])(
      'refuses to retry a %s render',
      async (status) => {
        const retryJob = jest.fn();
        const service = createService(
          {
            clipRender: {
              findFirst: jest.fn().mockResolvedValue({
                ...failedRender,
                processingJob: { status },
              }),
            },
          },
          { retryJob },
        );

        await expect(
          service.retry('user-1', 'render-1'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(retryJob).not.toHaveBeenCalled();
      },
    );

    it("never retries another user's render", async () => {
      const retryJob = jest.fn();
      const service = createService(
        { clipRender: { findFirst: jest.fn().mockResolvedValue(null) } },
        { retryJob },
      );

      await expect(service.retry('user-2', 'render-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(retryJob).not.toHaveBeenCalled();
    });
  });
  describe('deleteSubtitledRenders', () => {
    const subtitledRender = {
      id: 'render-1',
      startSec: 10,
      endSec: 30,
      subtitleStyle: {
        fontFamily: 'Cairo',
        fontSizePx: 34,
        bold: true,
        textColor: '#ffffff',
        backgroundColor: '#000000',
        backgroundOpacity: 0.6,
        position: 'MIDDLE',
        displayMode: 'WORD',
      },
      subtitleCues: [{ index: 1, startSec: 1, endSec: 2, text: 'أصلاً' }],
      clip: { video: { cloudinaryId: 'cloud/video-1' } },
    };

    it('removes finished subtitled renders and their Cloudinary copies', async () => {
      const prisma = {
        video: { findFirst: jest.fn().mockResolvedValue({ id: 'video-1' }) },
        clipRender: {
          findMany: jest.fn().mockResolvedValue([subtitledRender]),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const deleteClipReelRender = jest.fn().mockResolvedValue(undefined);
      const service = createService(prisma, {}, {}, { deleteClipReelRender });

      await expect(
        service.deleteSubtitledRenders('user-1', { videoId: 'video-1' }),
      ).resolves.toEqual({ deleted: 1 });

      expect(deleteClipReelRender).toHaveBeenCalledWith(
        'cloud/video-1',
        10,
        30,
        expect.objectContaining({ style: subtitledRender.subtitleStyle }),
      );
      expect(prisma.clipRender.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['render-1'] } },
      });
    });

    it('does not find a video that belongs to someone else', async () => {
      const prisma = {
        video: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(
        createService(prisma).deleteSubtitledRenders('user-2', {
          videoId: 'video-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
