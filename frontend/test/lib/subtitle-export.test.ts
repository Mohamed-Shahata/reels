import {
  applyCueEdits,
  buildClipSubtitleFile,
  formatSubtitleTime,
  subtitleFileName,
} from '@/lib/subtitle-export';

const cues = [
  { index: 1, startSec: 0.5, endSec: 2, text: 'أصلاً' },
  { index: 2, startSec: 3661.25, endSec: 3663, text: 'second' },
];

describe('subtitle export', () => {
  it('formats times for SRT and VTT', () => {
    expect(formatSubtitleTime(3661.25, ',')).toBe('01:01:01,250');
    expect(formatSubtitleTime(0.5, '.')).toBe('00:00:00.500');
  });

  it('applies edits and hides cues edited to empty text', () => {
    const result = applyCueEdits(cues, [
      { index: 1, text: ' مرحبا ' },
      { index: 2, text: '' },
    ]);
    expect(result).toEqual([{ ...cues[0], text: 'مرحبا' }]);
  });

  it('builds an SRT with a UTF-8 BOM', () => {
    expect(buildClipSubtitleFile(cues, [], 'srt')).toBe(
      '\ufeff1\n00:00:00,500 --> 00:00:02,000\nأصلاً\n\n2\n01:01:01,250 --> 01:01:03,000\nsecond\n',
    );
  });

  it('builds VTT and TXT, and an empty string without visible cues', () => {
    expect(buildClipSubtitleFile(cues, [], 'vtt')).toContain('WEBVTT');
    expect(buildClipSubtitleFile(cues, [], 'txt')).toBe(
      '\ufeffأصلاً\nsecond\n',
    );
    expect(buildClipSubtitleFile([], [], 'srt')).toBe('');
  });

  it('makes a safe file name', () => {
    expect(subtitleFileName({ id: 'c1', title: 'a/b: c?' }, 'srt')).toBe(
      'a b c.srt',
    );
    expect(subtitleFileName({ id: 'c1', title: '  ' }, 'vtt')).toBe(
      'clip-c1.vtt',
    );
  });
});
