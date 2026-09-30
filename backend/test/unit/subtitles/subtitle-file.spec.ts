import type { SubtitleCue } from '../../../src/subtitles/subtitle-cue-builder';
import {
  buildSrt,
  normalizeCueText,
  wrapCueText,
  subtitleFileKey,
} from '../../../src/subtitles/subtitle-file';

const cues: SubtitleCue[] = [
  { index: 1, startSec: 0.5, endSec: 2.5, text: 'First line' },
  { index: 2, startSec: 3725.123, endSec: 3726, text: 'Second line' },
];

describe('buildSrt', () => {
  it('writes numbered blocks with comma separated milliseconds', () => {
    expect(buildSrt(cues)).toBe(
      '1\n00:00:00,500 --> 00:00:02,500\nFirst line\n\n' +
        '2\n01:02:05,123 --> 01:02:06,000\nSecond line\n',
    );
  });

  it('skips empty cues and cues that do not last, and renumbers', () => {
    const srt = buildSrt([
      { index: 1, startSec: 0, endSec: 1, text: '   ' },
      { index: 2, startSec: 3, endSec: 3, text: 'No duration' },
      { index: 3, startSec: 4, endSec: 5, text: 'Kept' },
    ]);

    expect(srt).toBe('1\n00:00:04,000 --> 00:00:05,000\nKept\n');
  });

  it('keeps Arabic text as it is', () => {
    expect(
      buildSrt([
        { index: 1, startSec: 0, endSec: 1, text: 'ازاي تكسب الناس؟' },
      ]),
    ).toContain('ازاي تكسب الناس؟');
  });

  it('returns an empty string for a clip without speech', () => {
    expect(buildSrt([])).toBe('');
  });

  it('does not grow a URL: any number of cues is just file content', () => {
    const many: SubtitleCue[] = Array.from({ length: 500 }, (_, i) => ({
      index: i + 1,
      startSec: i * 4,
      endSec: i * 4 + 3,
      text: 'مممممممممم',
    }));

    expect(buildSrt(many).split('\n\n')).toHaveLength(500);
  });
});

describe('subtitleFileKey', () => {
  it('is stable for the same content and differs otherwise', () => {
    expect(subtitleFileKey('a')).toBe(subtitleFileKey('a'));
    expect(subtitleFileKey('a')).not.toBe(subtitleFileKey('b'));
    expect(subtitleFileKey('a')).toHaveLength(32);
  });
});

describe('normalizeCueText', () => {
  it('collapses whitespace and removes control characters', () => {
    expect(normalizeCueText('  a\tb\n\nc\u0000d  ')).toBe('a b c d');
  });
});

describe('wrapCueText', () => {
  it('keeps a short cue on one line', () => {
    expect(wrapCueText('نتحدث عن نقطة')).toEqual(['نتحدث عن نقطة']);
  });

  it('keeps a single word on one line even when it is long', () => {
    expect(wrapCueText('a'.repeat(40))).toEqual(['a'.repeat(40)]);
  });

  it('balances lines so the last one is not a lone leftover word', () => {
    const lines = wrapCueText('نتحدث عن نقطة مهمة تحدثنا عنها');

    expect(lines).toHaveLength(2);
    expect(lines.join(' ')).toBe('نتحدث عن نقطة مهمة تحدثنا عنها');
    expect(lines.every((line) => line.split(' ').length > 1)).toBe(true);
  });

  it('uses as many lines as the length needs', () => {
    const lines = wrapCueText(
      'one two three four five six seven eight nine ten',
      15,
    );

    expect(lines.length).toBeGreaterThan(2);
    expect(lines.every((line) => line.length <= 20)).toBe(true);
  });

  it('writes the wrapped lines into the SRT block', () => {
    const srt = buildSrt([
      {
        index: 1,
        startSec: 0,
        endSec: 2,
        text: 'نتحدث عن نقطة مهمة تحدثنا عنها',
      },
    ]);

    expect(srt.split('\n')).toHaveLength(5);
  });
});
