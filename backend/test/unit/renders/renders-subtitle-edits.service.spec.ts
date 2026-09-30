import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../../../src/generated/prisma/client';
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
    subtitleEdits: null,
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

function setup() {
  const clipRender = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'render-1' }),
    update: jest.fn().mockResolvedValue(renderRecord()),
    delete: jest.fn(),
  };
  const clip = { findFirst: jest.fn().mockResolvedValue(clipWithTranscript) };
  const buildCues = jest
    .fn()
    .mockResolvedValue({ cues, timing: 'WORD' as const });
  const service = new RendersService(
    { clip, clipRender } as unknown as PrismaService,
    {
      createJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    } as unknown as ProcessingJobsService,
    { buildCues } as unknown as SubtitlesService,
    {} as unknown as StorageService,
  );
  return { service, clipRender, buildCues };
}

function createdData(clipRender: { create: jest.Mock }) {
  return (
    clipRender.create.mock.calls[0] as [{ data: Record<string, unknown> }]
  )[0].data;
}

describe('RendersService subtitle edits', () => {
  describe('create', () => {
    it('stores the edited cues and the applied edits', async () => {
      const { service, clipRender } = setup();

      await service.create('user-1', 'clip-1', {
        subtitles: true,
        subtitleEdits: [{ index: 2, text: 'Fixed line' }],
      });

      const data = createdData(clipRender);
      expect(data.subtitleCues).toEqual([
        cues[0],
        { ...cues[1], text: 'Fixed line' },
      ]);
      expect(data.subtitleEdits).toEqual([{ index: 2, text: 'Fixed line' }]);
    });

    it('removes a cue that is edited to nothing from the stored cues', async () => {
      const { service, clipRender } = setup();

      await service.create('user-1', 'clip-1', {
        subtitles: true,
        subtitleEdits: [{ index: 1, text: '' }],
      });

      expect(createdData(clipRender).subtitleCues).toEqual([cues[1]]);
    });

    it('gives an edited render a different key from the unedited one', async () => {
      const first = setup();
      const second = setup();

      await first.service.create('user-1', 'clip-1', { subtitles: true });
      await second.service.create('user-1', 'clip-1', {
        subtitles: true,
        subtitleEdits: [{ index: 1, text: 'Changed' }],
      });

      expect(createdData(first.clipRender).subtitleKey).not.toBe(
        createdData(second.clipRender).subtitleKey,
      );
    });

    it('gives the same key to the same edits so the render is reused', async () => {
      const first = setup();
      const second = setup();
      const dto = {
        subtitles: true,
        subtitleEdits: [{ index: 1, text: 'Changed' }],
      };

      await first.service.create('user-1', 'clip-1', dto);
      await second.service.create('user-1', 'clip-1', dto);

      expect(createdData(first.clipRender).subtitleKey).toBe(
        createdData(second.clipRender).subtitleKey,
      );
    });

    it('does not store edits that leave the text unchanged', async () => {
      const { service, clipRender } = setup();

      await service.create('user-1', 'clip-1', {
        subtitles: true,
        subtitleEdits: [{ index: 1, text: 'Hello there' }],
      });

      expect(createdData(clipRender)).not.toHaveProperty('subtitleEdits');
    });

    it('rejects edits when subtitles are not enabled', async () => {
      const { service, clipRender } = setup();

      await expect(
        service.create('user-1', 'clip-1', {
          subtitleEdits: [{ index: 1, text: 'Changed' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(clipRender.create).not.toHaveBeenCalled();
    });

    it('rejects an edit for a cue that does not exist and queues nothing', async () => {
      const { service, clipRender } = setup();

      await expect(
        service.create('user-1', 'clip-1', {
          subtitles: true,
          subtitleEdits: [{ index: 7, text: 'Missing' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(clipRender.create).not.toHaveBeenCalled();
    });

    it('reports the edits in the returned render', async () => {
      const { service, clipRender } = setup();
      clipRender.update.mockResolvedValue(
        renderRecord({
          subtitleStyle: reelStyle,
          subtitleEdits: [{ index: 2, text: 'Fixed line' }],
        }),
      );

      const result = await service.create('user-1', 'clip-1', {
        subtitles: true,
        subtitleEdits: [{ index: 2, text: 'Fixed line' }],
      });

      expect(result.subtitleEdits).toEqual([{ index: 2, text: 'Fixed line' }]);
    });

    it('reports no edits for a render without any', async () => {
      const { service } = setup();

      const result = await service.create('user-1', 'clip-1');

      expect(result.subtitleEdits).toEqual([]);
    });
  });

  describe('retry', () => {
    function retrySetup(render: Record<string, unknown>) {
      const clipRender = {
        findFirst: jest.fn().mockResolvedValue({
          id: 'render-1',
          processingJobId: 'job-1',
          startSec: 10,
          endSec: 30,
          subtitleStyle: reelStyle,
          subtitleEdits: null,
          processingJob: { status: 'FAILED' },
          clip: {
            startSec: 10,
            endSec: 30,
            video: { transcript: { id: 'transcript-1' } },
          },
          ...render,
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
      return { service, clipRender };
    }

    function updatedData(clipRender: { update: jest.Mock }) {
      return (
        clipRender.update.mock.calls[0] as [{ data: Record<string, unknown> }]
      )[0].data;
    }

    it('keeps the edits when the clip range has not changed', async () => {
      const { service, clipRender } = retrySetup({
        subtitleEdits: [{ index: 2, text: 'Fixed line' }],
      });

      await service.retry('user-1', 'render-1');

      const data = updatedData(clipRender);
      expect(data.subtitleCues).toEqual([
        cues[0],
        { ...cues[1], text: 'Fixed line' },
      ]);
      expect(data.subtitleEdits).toEqual([{ index: 2, text: 'Fixed line' }]);
    });

    it('drops the edits when the clip range changed since the render', async () => {
      const { service, clipRender } = retrySetup({
        subtitleEdits: [{ index: 2, text: 'Fixed line' }],
        clip: {
          startSec: 12,
          endSec: 34,
          video: { transcript: { id: 'transcript-1' } },
        },
      });

      await service.retry('user-1', 'render-1');

      const data = updatedData(clipRender);
      expect(data.subtitleCues).toEqual(cues);
      expect(data.subtitleEdits).toBe(Prisma.DbNull);
    });

    it('does not fail when a stored edit no longer matches a cue', async () => {
      const { service, clipRender } = retrySetup({
        subtitleEdits: [
          { index: 9, text: 'Gone' },
          { index: 1, text: 'Still here' },
        ],
      });

      await service.retry('user-1', 'render-1');

      expect(updatedData(clipRender).subtitleEdits).toEqual([
        { index: 1, text: 'Still here' },
      ]);
    });

    it('leaves the edits column alone for a render that had none', async () => {
      const { service, clipRender } = retrySetup({});

      await service.retry('user-1', 'render-1');

      expect(updatedData(clipRender)).not.toHaveProperty('subtitleEdits');
    });
  });
});
