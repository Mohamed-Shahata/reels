import {
  estimateRemaining,
  formatClock,
  formatFileSize,
  formatResolution,
  titleFromFileName,
} from '@/lib/upload-format';

describe('upload format helpers', () => {
  it('formats file sizes', () => {
    expect(formatFileSize(1.24 * 1024 ** 3)).toBe('1.24 GB');
    expect(formatFileSize(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatFileSize(2048)).toBe('2 KB');
  });

  it('formats resolution and clock values', () => {
    expect(formatResolution(1080)).toBe('1080p');
    expect(formatResolution(0)).toBeNull();
    expect(formatClock(44 * 60 + 18)).toBe('44:18');
    expect(formatClock(3725)).toBe('1:02:05');
  });

  it('estimates remaining upload time only once it is meaningful', () => {
    expect(estimateRemaining(1000, 10)).toBeNull();
    expect(estimateRemaining(60_000, 50)).toBe('~1 min left');
    expect(estimateRemaining(60_000, 10)).toBe('~9 mins left');
    expect(estimateRemaining(60_000, 100)).toBeNull();
  });

  it('builds a readable title from a file name', () => {
    expect(titleFromFileName('podcast_ep14_ar.mp4')).toBe('podcast ep14 ar');
    expect(titleFromFileName('.mp4')).toBe(
      '.mp4'.replace(/\.[^.]+$/, '') || 'Untitled video',
    );
  });
});
