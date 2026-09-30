import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import { SubtitlesService } from '../../../src/subtitles/subtitles.service';

interface FakeSegment {
  startSec: number;
  endSec: number;
  text: string;
  words: unknown;
}

function createService(options: { clip?: unknown; segments?: FakeSegment[] }) {
  const clip = {
    findFirst: jest.fn().mockResolvedValue(options.clip ?? null),
  };
  const transcriptSegment = {
    findMany: jest.fn().mockResolvedValue(options.segments ?? []),
  };
  const service = new SubtitlesService({
    clip,
    transcriptSegment,
  } as unknown as PrismaService);

  return { service, clip, transcriptSegment };
}

const clipRow = {
  id: 'clip-1',
  startSec: 100,
  endSec: 110,
  video: { transcript: { id: 'transcript-1', language: 'ar' } },
};

const measuredSegment: FakeSegment = {
  startSec: 99,
  endSec: 104,
  text: 'مرحبا بكم في الحلقة',
  words: [
    { word: 'مرحبا', startSec: 100.5, endSec: 100.9 },
    { word: 'بكم', startSec: 101, endSec: 101.4 },
    { word: 'في', startSec: 101.5, endSec: 101.7 },
    { word: 'الحلقة', startSec: 101.8, endSec: 102.5 },
  ],
};

describe('SubtitlesService.getClipSubtitles', () => {
  it('scopes the clip lookup to the requesting user', async () => {
    const { service, clip } = createService({ clip: clipRow });

    await service.getClipSubtitles('user-1', 'clip-1');

    expect(clip.findFirst).toHaveBeenCalledWith({
      where: { id: 'clip-1', video: { is: { userId: 'user-1' } } },
      select: {
        id: true,
        startSec: true,
        endSec: true,
        video: {
          select: { transcript: { select: { id: true, language: true } } },
        },
      },
    });
  });

  it('returns 404 for a clip that is missing or owned by someone else', async () => {
    const { service, transcriptSegment } = createService({ clip: null });

    await expect(
      service.getClipSubtitles('user-2', 'clip-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(transcriptSegment.findMany).not.toHaveBeenCalled();
  });

  it('returns 409 when the video has no transcript yet', async () => {
    const { service, transcriptSegment } = createService({
      clip: { ...clipRow, video: { transcript: null } },
    });

    await expect(
      service.getClipSubtitles('user-1', 'clip-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(transcriptSegment.findMany).not.toHaveBeenCalled();
  });

  it('only loads segments around the clip range', async () => {
    const { service, transcriptSegment } = createService({ clip: clipRow });

    await service.getClipSubtitles('user-1', 'clip-1');

    expect(transcriptSegment.findMany).toHaveBeenCalledWith({
      where: {
        transcriptId: 'transcript-1',
        startSec: { lt: 111 },
        endSec: { gt: 99 },
      },
      orderBy: { startSec: 'asc' },
      select: { startSec: true, endSec: true, text: true, words: true },
    });
  });

  it('builds cues from word timestamps relative to the clip start', async () => {
    const { service } = createService({
      clip: clipRow,
      segments: [measuredSegment],
    });

    const result = await service.getClipSubtitles('user-1', 'clip-1');

    expect(result).toEqual({
      clipId: 'clip-1',
      language: 'ar',
      startSec: 100,
      endSec: 110,
      durationSec: 10,
      timing: 'WORD',
      cues: [
        {
          index: 1,
          startSec: 0.5,
          endSec: 2.5,
          text: 'مرحبا بكم في الحلقة',
        },
      ],
    });
  });

  it('keeps cue timing exact for words from several segments', async () => {
    const { service } = createService({
      clip: clipRow,
      segments: [
        measuredSegment,
        {
          startSec: 106,
          endSec: 108,
          text: 'شكرا لكم',
          words: [
            { word: 'شكرا', startSec: 106.25, endSec: 106.75 },
            { word: 'لكم', startSec: 106.8, endSec: 107.2 },
          ],
        },
      ],
    });

    const result = await service.getClipSubtitles('user-1', 'clip-1');

    expect(result.timing).toBe('WORD');
    expect(result.cues.map((cue) => [cue.startSec, cue.endSec])).toEqual([
      [0.5, 2.5],
      [6.25, 7.2],
    ]);
  });

  it('estimates timing for transcripts stored without words', async () => {
    const { service } = createService({
      clip: clipRow,
      segments: [
        {
          startSec: 101,
          endSec: 105,
          text: 'hello there my friend',
          words: null,
        },
      ],
    });

    const result = await service.getClipSubtitles('user-1', 'clip-1');

    expect(result.timing).toBe('ESTIMATED');
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0].text).toBe('hello there my friend');
    expect(result.cues[0].startSec).toBe(1);
    expect(result.cues[0].endSec).toBe(5);
  });

  it('reports mixed timing when only some segments have words', async () => {
    const { service } = createService({
      clip: clipRow,
      segments: [
        measuredSegment,
        { startSec: 107, endSec: 109, text: 'no words here', words: null },
      ],
    });

    const result = await service.getClipSubtitles('user-1', 'clip-1');

    expect(result.timing).toBe('MIXED');
    expect(result.cues).toHaveLength(2);
  });

  it('falls back to estimated timing when stored words are malformed', async () => {
    const { service } = createService({
      clip: clipRow,
      segments: [
        {
          startSec: 101,
          endSec: 103,
          text: 'broken words',
          words: [{ word: 1 }, 'oops', null, { word: 'x', startSec: 'a' }],
        },
      ],
    });

    const result = await service.getClipSubtitles('user-1', 'clip-1');

    expect(result.timing).toBe('ESTIMATED');
    expect(result.cues[0].text).toBe('broken words');
  });

  it('trims a segment that runs past the clip edge', async () => {
    const { service } = createService({
      clip: clipRow,
      segments: [
        {
          startSec: 98,
          endSec: 102,
          text: 'cut across the start',
          words: [
            { word: 'cut', startSec: 98.2, endSec: 98.6 },
            { word: 'across', startSec: 99, endSec: 99.6 },
            { word: 'the', startSec: 100.2, endSec: 100.5 },
            { word: 'start', startSec: 100.6, endSec: 101.2 },
          ],
        },
      ],
    });

    const result = await service.getClipSubtitles('user-1', 'clip-1');

    expect(result.cues).toEqual([
      { index: 1, startSec: 0.2, endSec: 1.2, text: 'the start' },
    ]);
  });

  it('returns no cues for a clip without speech', async () => {
    const { service } = createService({ clip: clipRow, segments: [] });

    const result = await service.getClipSubtitles('user-1', 'clip-1');

    expect(result.timing).toBe('NONE');
    expect(result.cues).toEqual([]);
  });
});
