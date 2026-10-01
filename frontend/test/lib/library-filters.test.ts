import type { LibrarySummary } from '@/lib/api';
import {
  filterVideos,
  formatDuration,
  sortVideos,
} from '@/lib/library-filters';

function video(overrides: Partial<LibrarySummary>): LibrarySummary {
  return {
    id: 'v',
    title: 'Title',
    cloudinaryId: 'c',
    durationSec: 60,
    sizeBytes: '1',
    status: 'READY',
    createdAt: '2026-09-01T00:00:00.000Z',
    thumbnailUrl: null,
    clipCount: 0,
    reelCount: 0,
    transcriptReady: true,
    transcriptionState: 'COMPLETED',
    transcriptionProgress: 100,
    failureReason: null,
    ...overrides,
  };
}

describe('library filters', () => {
  const done = video({ id: 'done', reelCount: 2 });
  const uploading = video({ id: 'up', status: 'UPLOADING' });
  const transcribing = video({
    id: 'tr',
    transcriptReady: false,
    transcriptionState: 'RUNNING',
  });
  const failed = video({ id: 'fail', status: 'FAILED' });
  const all = [done, uploading, transcribing, failed];

  it('filters completed reels and in-progress work', () => {
    expect(filterVideos(all, 'all')).toHaveLength(4);
    expect(filterVideos(all, 'completed').map((v) => v.id)).toEqual(['done']);
    expect(filterVideos(all, 'in-progress').map((v) => v.id)).toEqual([
      'up',
      'tr',
    ]);
  });

  it('sorts by recency, age, title and duration', () => {
    const a = video({ id: 'a', title: 'ب', createdAt: '2026-09-01T00:00:00Z' });
    const b = video({
      id: 'b',
      title: 'أ',
      createdAt: '2026-09-03T00:00:00Z',
      durationSec: 500,
    });
    expect(sortVideos([a, b], 'recent').map((v) => v.id)).toEqual(['b', 'a']);
    expect(sortVideos([b, a], 'oldest').map((v) => v.id)).toEqual(['a', 'b']);
    expect(sortVideos([a, b], 'title').map((v) => v.id)).toEqual(['b', 'a']);
    expect(sortVideos([a, b], 'duration').map((v) => v.id)).toEqual(['b', 'a']);
  });

  it('formats durations', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
