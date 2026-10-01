import {
  buildSubtitleFile,
  estimateViralScore,
  filterClips,
  hasHook,
  scoreTier,
  searchSegments,
} from '@/lib/clip-insights';
import type { Transcript } from '@/lib/api';

const transcript: Transcript = {
  id: 't',
  videoId: 'v',
  language: 'ar',
  segments: [
    { id: 'a', startSec: 0, endSec: 10, text: 'ازاي تكسب الناس؟ خطوة اولى' },
    { id: 'b', startSec: 10, endSec: 20, text: 'كلام عادي جدا هنا' },
  ],
};

describe('clip insights', () => {
  it('detects a hook in the opening segment', () => {
    expect(hasHook(transcript, { startSec: 0, endSec: 10 })).toBe(true);
    expect(hasHook(transcript, { startSec: 10, endSec: 20 })).toBe(false);
  });

  it('keeps the score in range and ranks hooks higher', () => {
    const hooked = estimateViralScore(transcript, {
      startSec: 0,
      endSec: 30,
      source: 'AI',
    });
    const plain = estimateViralScore(transcript, {
      startSec: 10,
      endSec: 30,
      source: 'AI',
    });
    expect(hooked).toBeGreaterThan(plain);
    expect(hooked).toBeLessThanOrEqual(99);
    expect(plain).toBeGreaterThanOrEqual(40);
  });

  it('maps scores to tiers and filters', () => {
    expect(scoreTier(95)).toBe('Viral');
    expect(scoreTier(72)).toBe('Good');
    const items = [
      { score: 95, ready: true },
      { score: 70, ready: false },
    ];
    expect(filterClips(items, 'hooks')).toHaveLength(1);
    expect(filterClips(items, 'draft')).toHaveLength(1);
    expect(filterClips(items, 'all')).toHaveLength(2);
  });

  it('searches segments and builds SRT/VTT', () => {
    expect(searchSegments(transcript.segments, 'عادي')).toHaveLength(1);
    expect(buildSubtitleFile(transcript.segments, 'srt')).toContain(
      '00:00:00,000 --> 00:00:10,000',
    );
    expect(buildSubtitleFile(transcript.segments, 'vtt')).toMatch(/^WEBVTT/);
  });
});

describe('formatClipLength', () => {
  it('formats seconds and minutes', () => {
    const { formatClipLength } = jest.requireActual('@/lib/clip-insights');
    expect(formatClipLength(0, 30)).toBe('30s');
    expect(formatClipLength(10, 70)).toBe('1m');
    expect(formatClipLength(0, 75)).toBe('1m 15s');
    expect(formatClipLength(50, 40)).toBe('0s');
  });
});
