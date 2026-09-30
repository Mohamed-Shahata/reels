import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';
import { RendersService } from '../../../src/renders/renders.service';
import type { StorageService } from '../../../src/storage/storage.service';
import { getSubtitlePreset } from '../../../src/subtitles/subtitle-style';
import type { SubtitlesService } from '../../../src/subtitles/subtitles.service';

const reelStyle = getSubtitlePreset('REEL').style;
const cues = [
  { index: 1, startSec: 0.5, endSec: 2, text: 'Hello there' },
  { index: 2, startSec: 2, endSec: 4, text: 'Second line' },
];

const clipWithTranscript = {
  id: 'clip-1',
  startSec: 10,
  endSec: 30,
  video: {
    id: 'video-1',
    status: 'READY',
    cloudinaryId: 'cloud/video-1',
    transcript: { id: 'transcript-1' },
  },
};

function renderRecord(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-09-29T00:00:00.000Z');
  return {
    id: 'render-1',
    clipId: 'clip-1',
    startSec: 10,
    endSec: 30,
    outputUrl: null,
    subtitleStyle: null,
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

function setup(
  options: {
    clip?: unknown;
    existing?: unknown;
    buildCues?: jest.Mock;
    storage?: Record<string, jest.Mock>;
  } = {},
) {
  const clipRender = {
    findFirst: jest.fn().mockResolvedValue(options.existing ?? null),
    create: jest.fn().mockResolvedValue({ id: 'render-1' }),
    update: jest
      .fn()
      .mockResolvedValue(renderRecord({ subtitleStyle: reelStyle })),
    delete: jest.fn(),
  };
  const clip = {
    findFirst: jest
      .fn()
      .mockResolvedValue(
        options.clip === undefined ? clipWithTranscript : options.clip,
      ),
  };
  const createJob = jest.fn().mockResolvedValue({ id: 'job-1' });
  const buildCues =
    options.buildCues ??
    jest.fn().mockResolvedValue({ cues, timing: 'WORD' as const });
  const service = new RendersService(
    { clip, clipRender } as unknown as PrismaService,
    { createJob } as unknown as ProcessingJobsService,
    { buildCues } as unknown as SubtitlesService,
    (options.storage ?? {}) as unknown as StorageService,
  );
  return { service, clipRender, clip, createJob, buildCues };
}

describe('RendersService subtitles', () => {
  describe('create', () => {
    it('stores the resolved style and the cues of the render range when subtitles are on', async () => {
      const { service, clipRender, buildCues } = setup();

      const result = await service.create('user-1', 'clip-1', {
        subtitles: true,
        preset: 'HIGHLIGHT',
        fontSizePx: 50,
      });

      expect(buildCues).toHaveBeenCalledWith('transcript-1', 10, 30);
      const data = (
        clipRender.create.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
      expect(data).toMatchObject({
        clipId: 'clip-1',
        startSec: 10,
        endSec: 30,
        subtitleStyle: {
          ...getSubtitlePreset('HIGHLIGHT').style,
          fontSizePx: 50,
        },
        subtitleCues: cues,
      });
      expect(data.subtitleKey).toMatch(/^[0-9a-f]{64}$/);
      expect(result).toMatchObject({ subtitles: true });
    });

    it('uses the default preset when subtitles are on without a style', async () => {
      const { service, clipRender } = setup();

      await service.create('user-1', 'clip-1', { subtitles: true });

      expect(
        (
          clipRender.create.mock.calls[0] as [
            { data: { subtitleStyle: unknown } },
          ]
        )[0].data.subtitleStyle,
      ).toEqual(reelStyle);
    });

    it('renders without subtitles by default and never reads the transcript', async () => {
      const { service, clipRender, buildCues } = setup();
      clipRender.update.mockResolvedValue(renderRecord());

      const result = await service.create('user-1', 'clip-1');

      expect(buildCues).not.toHaveBeenCalled();
      expect(clipRender.create).toHaveBeenCalledWith({
        data: { clipId: 'clip-1', startSec: 10, endSec: 30 },
        select: { id: true },
      });
      expect(clipRender.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ subtitleKey: null }) as unknown,
        }),
      );
      expect(result.subtitles).toBe(false);
      expect(result.subtitleStyle).toBeNull();
    });

    it('looks for a reusable render of the same variant only', async () => {
      const { service, clipRender } = setup();

      await service.create('user-1', 'clip-1', { subtitles: true });

      const where = (
        clipRender.findFirst.mock.calls[0] as [
          { where: { subtitleKey: unknown } },
        ]
      )[0].where;
      expect(where.subtitleKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('gives a different key when the style or the text changes', async () => {
      const first = setup();
      const second = setup();
      const third = setup({
        buildCues: jest.fn().mockResolvedValue({
          cues: [{ index: 1, startSec: 0, endSec: 1, text: 'Changed' }],
          timing: 'WORD',
        }),
      });

      await first.service.create('user-1', 'clip-1', { subtitles: true });
      await second.service.create('user-1', 'clip-1', {
        subtitles: true,
        position: 'TOP',
      });
      await third.service.create('user-1', 'clip-1', { subtitles: true });

      const keyOf = (fake: ReturnType<typeof setup>) =>
        (
          fake.clipRender.create.mock.calls[0] as [
            { data: { subtitleKey: string } },
          ]
        )[0].data.subtitleKey;
      expect(new Set([keyOf(first), keyOf(second), keyOf(third)]).size).toBe(3);
    });

    it('reuses a finished subtitled render instead of queueing another', async () => {
      const { service, clipRender, createJob } = setup({
        existing: renderRecord({
          subtitleStyle: reelStyle,
          outputUrl: 'https://reel.example',
          processingJob: {
            status: 'COMPLETED',
            progress: 100,
            attempts: 1,
            lastError: null,
          },
        }),
      });

      const result = await service.create('user-1', 'clip-1', {
        subtitles: true,
      });

      expect(result).toMatchObject({
        id: 'render-1',
        status: 'COMPLETED',
        subtitles: true,
        subtitleStyle: reelStyle,
      });
      expect(clipRender.create).not.toHaveBeenCalled();
      expect(createJob).not.toHaveBeenCalled();
    });

    it('rejects a style that is sent without turning subtitles on', async () => {
      const { service, clipRender } = setup();

      await expect(
        service.create('user-1', 'clip-1', { position: 'TOP' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create('user-1', 'clip-1', {
          subtitles: false,
          preset: 'REEL',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(clipRender.create).not.toHaveBeenCalled();
    });

    it('requires a transcript before burning in subtitles', async () => {
      const { service, clipRender } = setup({
        clip: {
          ...clipWithTranscript,
          video: { ...clipWithTranscript.video, transcript: null },
        },
      });

      await expect(
        service.create('user-1', 'clip-1', { subtitles: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(clipRender.create).not.toHaveBeenCalled();
    });

    it('still renders a clip without a transcript when subtitles are off', async () => {
      const { service, clipRender } = setup({
        clip: {
          ...clipWithTranscript,
          video: { ...clipWithTranscript.video, transcript: null },
        },
      });

      await service.create('user-1', 'clip-1', { subtitles: false });

      expect(clipRender.create).toHaveBeenCalled();
    });

    it('queues a clip with a lot of speech instead of rejecting it', async () => {
      const longCues = Array.from({ length: 200 }, (_, index) => ({
        index: index + 1,
        startSec: index,
        endSec: index + 0.9,
        text: 'x'.repeat(36),
      }));
      const { service, clipRender } = setup({
        buildCues: jest
          .fn()
          .mockResolvedValue({ cues: longCues, timing: 'WORD' }),
      });

      await service.create('user-1', 'clip-1', { subtitles: true });

      expect(clipRender.create).toHaveBeenCalled();
    });

    it('still queues an empty subtitle render for a clip without speech', async () => {
      const { service, clipRender } = setup({
        buildCues: jest.fn().mockResolvedValue({ cues: [], timing: 'NONE' }),
      });

      await service.create('user-1', 'clip-1', { subtitles: true });

      expect(clipRender.create).toHaveBeenCalled();
    });
  });

  describe('createForVideo', () => {
    it('applies the same subtitle style to every clip of the video', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'render-1' }),
        update: jest
          .fn()
          .mockResolvedValue(renderRecord({ subtitleStyle: reelStyle })),
      };
      const video = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'video-1',
          status: 'READY',
          cloudinaryId: 'cloud/video-1',
          transcript: { id: 'transcript-1' },
          clips: [
            { id: 'clip-1', startSec: 0, endSec: 20 },
            { id: 'clip-2', startSec: 20, endSec: 40 },
          ],
        }),
      };
      const buildCues = jest
        .fn()
        .mockResolvedValue({ cues, timing: 'WORD' as const });
      const service = new RendersService(
        { video, clipRender } as unknown as PrismaService,
        {
          createJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
        } as unknown as ProcessingJobsService,
        { buildCues } as unknown as SubtitlesService,
        {} as unknown as StorageService,
      );

      await service.createForVideo('user-1', 'video-1', {
        subtitles: true,
        preset: 'CLASSIC',
      });

      expect(buildCues).toHaveBeenNthCalledWith(1, 'transcript-1', 0, 20);
      expect(buildCues).toHaveBeenNthCalledWith(2, 'transcript-1', 20, 40);
      const styles = clipRender.create.mock.calls.map(
        (call) =>
          (call as [{ data: { subtitleStyle: unknown } }])[0].data
            .subtitleStyle,
      );
      expect(styles).toEqual([
        getSubtitlePreset('CLASSIC').style,
        getSubtitlePreset('CLASSIC').style,
      ]);
    });

    it('requires a transcript when burning in subtitles for the whole video', async () => {
      const video = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'video-1',
          status: 'READY',
          cloudinaryId: 'cloud/video-1',
          transcript: null,
          clips: [{ id: 'clip-1', startSec: 0, endSec: 20 }],
        }),
      };
      const clipRender = { create: jest.fn(), findFirst: jest.fn() };
      const service = new RendersService(
        { video, clipRender } as unknown as PrismaService,
        {} as unknown as ProcessingJobsService,
        {} as unknown as SubtitlesService,
        {} as unknown as StorageService,
      );

      await expect(
        service.createForVideo('user-1', 'video-1', { subtitles: true }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(clipRender.create).not.toHaveBeenCalled();
    });
  });

  describe('getDownloadUrl', () => {
    const completedRender = {
      id: 'render-1',
      startSec: 10,
      endSec: 30,
      subtitleStyle: reelStyle,
      subtitleCues: cues,
      processingJob: { status: 'COMPLETED' },
      clip: { id: 'clip-1', video: { cloudinaryId: 'cloud/video-1' } },
    };

    function downloadService(render: unknown) {
      const getClipDownloadUrl = jest.fn().mockReturnValue('https://download');
      const ensureSubtitleTransformation = jest
        .fn()
        .mockResolvedValue(undefined);
      const clipRender = { findFirst: jest.fn().mockResolvedValue(render) };
      const service = new RendersService(
        { clipRender } as unknown as PrismaService,
        {} as unknown as ProcessingJobsService,
        {} as unknown as SubtitlesService,
        {
          getClipDownloadUrl,
          ensureSubtitleTransformation,
        } as unknown as StorageService,
      );
      return {
        service,
        getClipDownloadUrl,
        ensureSubtitleTransformation,
        clipRender,
      };
    }

    it('builds the download with the stored subtitles so it matches the render', async () => {
      const {
        service,
        getClipDownloadUrl,
        ensureSubtitleTransformation,
        clipRender,
      } = downloadService(completedRender);

      await expect(service.getDownloadUrl('user-1', 'render-1')).resolves.toBe(
        'https://download',
      );

      expect(clipRender.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'render-1',
            clip: { is: { video: { is: { userId: 'user-1' } } } },
          },
        }),
      );
      expect(getClipDownloadUrl).toHaveBeenCalledWith(
        'cloud/video-1',
        10,
        30,
        'clip-clip-1-9x16-subtitled',
        { reframe: true, subtitles: { style: reelStyle, cues } },
      );
      expect(ensureSubtitleTransformation).toHaveBeenCalledWith({
        style: reelStyle,
        cues,
      });
    });

    it('builds a plain download for a render without subtitles', async () => {
      const { service, getClipDownloadUrl, ensureSubtitleTransformation } =
        downloadService({
          ...completedRender,
          subtitleStyle: null,
          subtitleCues: null,
        });

      await service.getDownloadUrl('user-1', 'render-1');
      expect(ensureSubtitleTransformation).not.toHaveBeenCalled();

      expect(getClipDownloadUrl).toHaveBeenCalledWith(
        'cloud/video-1',
        10,
        30,
        'clip-clip-1-9x16',
        { reframe: true, subtitles: undefined },
      );
    });

    it("never exposes another user's render", async () => {
      const { service, getClipDownloadUrl } = downloadService(null);

      await expect(
        service.getDownloadUrl('user-1', 'render-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(getClipDownloadUrl).not.toHaveBeenCalled();
    });

    it('refuses renders that are not finished', async () => {
      const { service, getClipDownloadUrl } = downloadService({
        ...completedRender,
        processingJob: { status: 'RUNNING' },
      });

      await expect(
        service.getDownloadUrl('user-1', 'render-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(getClipDownloadUrl).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('rebuilds the cues for the current clip range before re-queueing a subtitled render', async () => {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'render-1',
          processingJobId: 'job-1',
          subtitleStyle: reelStyle,
          processingJob: { status: 'FAILED' },
          clip: {
            startSec: 12,
            endSec: 34,
            video: { transcript: { id: 'transcript-1' } },
          },
        }),
        update: jest.fn().mockResolvedValue(undefined),
        findFirstOrThrow: jest.fn().mockResolvedValue(renderRecord()),
      };
      const buildCues = jest
        .fn()
        .mockResolvedValue({ cues, timing: 'WORD' as const });
      const retryJob = jest.fn().mockResolvedValue({ id: 'job-1' });
      const service = new RendersService(
        { clipRender } as unknown as PrismaService,
        { retryJob } as unknown as ProcessingJobsService,
        { buildCues } as unknown as SubtitlesService,
        {} as unknown as StorageService,
      );

      await service.retry('user-1', 'render-1');

      expect(buildCues).toHaveBeenCalledWith('transcript-1', 12, 34);
      expect(clipRender.update).toHaveBeenCalledWith({
        where: { id: 'render-1' },
        data: {
          startSec: 12,
          endSec: 34,
          outputUrl: null,
          subtitleCues: cues,
          subtitleKey: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
        },
      });
      expect(retryJob).toHaveBeenCalledWith('job-1');
    });
  });
});
