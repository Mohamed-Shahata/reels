import { BadRequestException } from '@nestjs/common';
import {
  applySubtitleEdits,
  readStoredEdits,
} from '../../../src/subtitles/subtitle-edits';

const cues = [
  { index: 1, startSec: 0.5, endSec: 2, text: 'Hello there' },
  { index: 2, startSec: 2, endSec: 4, text: 'Second line' },
  { index: 3, startSec: 4, endSec: 6, text: 'Third line' },
];

describe('applySubtitleEdits', () => {
  it('replaces the text of the edited cue and keeps its timing', () => {
    const result = applySubtitleEdits(cues, [{ index: 2, text: 'Fixed line' }]);

    expect(result.cues).toEqual([
      cues[0],
      { index: 2, startSec: 2, endSec: 4, text: 'Fixed line' },
      cues[2],
    ]);
    expect(result.edits).toEqual([{ index: 2, text: 'Fixed line' }]);
  });

  it('returns the original cues untouched when there are no edits', () => {
    expect(applySubtitleEdits(cues, [])).toEqual({ cues, edits: [] });
  });

  it('normalizes whitespace and control characters in the edited text', () => {
    const result = applySubtitleEdits(cues, [
      { index: 1, text: '  Hi \n\t  there  ' },
    ]);

    expect(result.cues[0].text).toBe('Hi there');
    expect(result.edits).toEqual([{ index: 1, text: 'Hi there' }]);
  });

  it('does not record an edit that leaves the text unchanged', () => {
    const result = applySubtitleEdits(cues, [
      { index: 1, text: ' Hello   there ' },
    ]);

    expect(result.cues).toEqual(cues);
    expect(result.edits).toEqual([]);
  });

  it('hides a cue whose text is edited to nothing', () => {
    const result = applySubtitleEdits(cues, [{ index: 2, text: '   ' }]);

    expect(result.cues.map((cue) => cue.index)).toEqual([1, 3]);
    expect(result.edits).toEqual([{ index: 2, text: '' }]);
  });

  it('returns the applied edits in cue order', () => {
    const result = applySubtitleEdits(cues, [
      { index: 3, text: 'C' },
      { index: 1, text: 'A' },
    ]);

    expect(result.edits.map((edit) => edit.index)).toEqual([1, 3]);
  });

  it('rejects an edit for a cue that does not exist', () => {
    expect(() =>
      applySubtitleEdits(cues, [{ index: 9, text: 'Missing' }]),
    ).toThrow(BadRequestException);
  });

  it('rejects two edits for the same cue', () => {
    expect(() =>
      applySubtitleEdits(cues, [
        { index: 1, text: 'One' },
        { index: 1, text: 'Two' },
      ]),
    ).toThrow(BadRequestException);
  });

  it('skips edits for missing cues when asked to ignore them', () => {
    const result = applySubtitleEdits(
      cues,
      [
        { index: 9, text: 'Missing' },
        { index: 3, text: 'Kept' },
      ],
      { ignoreUnknownCues: true },
    );

    expect(result.edits).toEqual([{ index: 3, text: 'Kept' }]);
    expect(result.cues[2].text).toBe('Kept');
  });

  it('does not mutate the input cues', () => {
    const before = JSON.stringify(cues);

    applySubtitleEdits(cues, [{ index: 1, text: 'Changed' }]);

    expect(JSON.stringify(cues)).toBe(before);
  });
});

describe('readStoredEdits', () => {
  it('reads valid stored edits and ignores malformed entries', () => {
    expect(
      readStoredEdits([
        { index: 1, text: 'One' },
        { index: 1.5, text: 'Fractional' },
        { index: 2 },
        null,
        'text',
      ]),
    ).toEqual([{ index: 1, text: 'One' }]);
  });

  it('returns an empty list for missing or non array values', () => {
    expect(readStoredEdits(null)).toEqual([]);
    expect(readStoredEdits(undefined)).toEqual([]);
    expect(readStoredEdits({ index: 1, text: 'One' })).toEqual([]);
  });
});
