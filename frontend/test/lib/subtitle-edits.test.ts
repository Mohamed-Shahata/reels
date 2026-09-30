import type { SubtitleCue } from '@/lib/api';
import {
  countHiddenCues,
  draftsToEdits,
  draftText,
  editsForClip,
  editsToDrafts,
  formatCueTime,
  normalizeCueText,
  sameEdits,
  setClipEdits,
} from '@/lib/subtitle-edits';

const cues: SubtitleCue[] = [
  { index: 1, startSec: 0.5, endSec: 2, text: 'Hello there' },
  { index: 2, startSec: 2, endSec: 4, text: 'Second line' },
];
const clip = { id: 'clip-1', startSec: 10, endSec: 30 };

describe('normalizeCueText', () => {
  it('collapses whitespace and control characters', () => {
    expect(normalizeCueText('  Hi \n\t there  ')).toBe('Hi there');
  });
});

describe('draftsToEdits', () => {
  it('returns only the cues whose text changed', () => {
    expect(draftsToEdits(cues, { 2: 'Fixed line' })).toEqual([
      { index: 2, text: 'Fixed line' },
    ]);
  });

  it('ignores a draft that only differs by whitespace', () => {
    expect(draftsToEdits(cues, { 1: '  Hello   there ' })).toEqual([]);
  });

  it('keeps a cleared line as an empty edit so it is hidden', () => {
    expect(draftsToEdits(cues, { 1: '   ' })).toEqual([{ index: 1, text: '' }]);
  });

  it('ignores drafts for cues that do not exist', () => {
    expect(draftsToEdits(cues, { 9: 'Missing' })).toEqual([]);
  });

  it('returns edits in cue order', () => {
    expect(draftsToEdits(cues, { 2: 'B', 1: 'A' })).toEqual([
      { index: 1, text: 'A' },
      { index: 2, text: 'B' },
    ]);
  });
});

describe('drafts', () => {
  it('shows the edited text and falls back to the cue text', () => {
    const drafts = editsToDrafts([{ index: 2, text: 'Fixed line' }]);

    expect(draftText(cues[0], drafts)).toBe('Hello there');
    expect(draftText(cues[1], drafts)).toBe('Fixed line');
  });

  it('shows an emptied line as empty instead of the original text', () => {
    expect(draftText(cues[0], { 1: '' })).toBe('');
  });
});

describe('sameEdits', () => {
  it('treats the same edits in any order as equal', () => {
    expect(
      sameEdits(
        [
          { index: 1, text: 'A' },
          { index: 2, text: 'B' },
        ],
        [
          { index: 2, text: 'B' },
          { index: 1, text: 'A' },
        ],
      ),
    ).toBe(true);
  });

  it('detects a different text, index or count', () => {
    expect(
      sameEdits([{ index: 1, text: 'A' }], [{ index: 1, text: 'B' }]),
    ).toBe(false);
    expect(
      sameEdits([{ index: 1, text: 'A' }], [{ index: 2, text: 'A' }]),
    ).toBe(false);
    expect(sameEdits([{ index: 1, text: 'A' }], [])).toBe(false);
  });

  it('treats two empty lists as equal', () => {
    expect(sameEdits([], [])).toBe(true);
  });
});

describe('edits by clip', () => {
  it('returns the edits of a clip while its range is unchanged', () => {
    const store = setClipEdits({}, clip, [{ index: 1, text: 'A' }]);

    expect(editsForClip(store, clip)).toEqual([{ index: 1, text: 'A' }]);
  });

  it('drops the edits once the clip range changed', () => {
    const store = setClipEdits({}, clip, [{ index: 1, text: 'A' }]);

    expect(editsForClip(store, { ...clip, endSec: 31 })).toEqual([]);
    expect(editsForClip(store, { ...clip, startSec: 9 })).toEqual([]);
  });

  it('returns nothing for a clip without edits', () => {
    expect(editsForClip({}, clip)).toEqual([]);
  });

  it('removes the entry when the edits are cleared', () => {
    const store = setClipEdits({}, clip, [{ index: 1, text: 'A' }]);

    expect(setClipEdits(store, clip, [])).toEqual({});
  });

  it('keeps the edits of other clips', () => {
    const other = { id: 'clip-2', startSec: 0, endSec: 20 };
    const store = setClipEdits(
      setClipEdits({}, clip, [{ index: 1, text: 'A' }]),
      other,
      [{ index: 2, text: 'B' }],
    );

    expect(editsForClip(store, clip)).toEqual([{ index: 1, text: 'A' }]);
    expect(editsForClip(store, other)).toEqual([{ index: 2, text: 'B' }]);
  });
});

describe('helpers', () => {
  it('counts hidden lines', () => {
    expect(
      countHiddenCues([
        { index: 1, text: '' },
        { index: 2, text: 'B' },
      ]),
    ).toBe(1);
  });

  it('formats cue times as minutes and seconds', () => {
    expect(formatCueTime(0)).toBe('0:00.0');
    expect(formatCueTime(2.04)).toBe('0:02.0');
    expect(formatCueTime(75.5)).toBe('1:15.5');
  });
});
