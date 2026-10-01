import {
  boundarySentences,
  checkRange,
  estimateFileMb,
  moveHandle,
  parseClock,
  quickTrimEnd,
  snapToSentences,
} from '@/lib/trimmer';
import type { Transcript } from '@/lib/api';

const transcript: Transcript = {
  id: 't',
  videoId: 'v',
  language: 'ar',
  segments: [
    { id: 'a', startSec: 10, endSec: 20, text: 'one' },
    { id: 'b', startSec: 20, endSec: 41, text: 'two' },
  ],
};

describe('trimmer', () => {
  it('parses clock values', () => {
    expect(parseClock('04:10')).toBe(250);
    expect(parseClock('4:75')).toBeNull();
    expect(parseClock('abc')).toBeNull();
  });

  it('validates ranges', () => {
    expect(checkRange(250, 280, 1680)).toEqual({
      startBeforeEnd: true,
      withinBounds: true,
      durationOk: true,
      sweetSpot: true,
    });
    expect(checkRange(250, 252, 1680).durationOk).toBe(false);
    expect(checkRange(250, 2000, 1680).withinBounds).toBe(false);
    expect(checkRange(null, 10, 100).startBeforeEnd).toBe(false);
  });

  it('applies quick trims and clamps to the episode', () => {
    expect(quickTrimEnd(250, 30, 1680)).toBe(280);
    expect(quickTrimEnd(1670, 30, 1680)).toBe(1680);
  });

  it('keeps dragged handles valid', () => {
    const range = { startSec: 100, endSec: 130 };
    expect(moveHandle('start', 129, range, 500).startSec).toBe(125);
    expect(moveHandle('end', 101, range, 500).endSec).toBe(105);
    expect(moveHandle('end', 900, range, 500).endSec).toBe(500);
  });

  it('snaps to sentence boundaries within tolerance only', () => {
    expect(
      snapToSentences(transcript, { startSec: 11.5, endSec: 39.5 }),
    ).toEqual({
      startSec: 10,
      endSec: 41,
    });
    expect(snapToSentences(transcript, { startSec: 15, endSec: 30 })).toEqual({
      startSec: 15,
      endSec: 30,
    });
  });

  it('finds opening and closing sentences and estimates size', () => {
    const { opening, closing } = boundarySentences(transcript, {
      startSec: 10,
      endSec: 41,
    });
    expect(opening?.id).toBe('a');
    expect(closing?.id).toBe('b');
    expect(estimateFileMb(30)).toBeCloseTo(24.9, 1);
  });
});
