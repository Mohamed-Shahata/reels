import {
  validateVideoDuration,
  validateVideoFile,
} from '@/lib/video-validation';

const constraints = {
  allowedFormats: ['mp4', 'webm'],
  maxFileSizeBytes: 1000,
  maxDurationSec: 60,
};

describe('video validation', () => {
  it('accepts allowed file formats below the configured size', () => {
    const file = new File(['content'], 'Episode.MP4', { type: 'video/mp4' });

    expect(validateVideoFile(file, constraints)).toBeNull();
  });

  it('rejects a disallowed file format and oversized files before upload', () => {
    expect(
      validateVideoFile(new File(['content'], 'episode.mov'), constraints),
    ).toMatch(/mp4, webm/);
    expect(
      validateVideoFile(
        new File(['x'.repeat(1001)], 'episode.mp4'),
        constraints,
      ),
    ).toMatch(/larger/);
  });

  it('rejects missing, invalid and over-limit durations', () => {
    expect(validateVideoDuration(0, constraints)).toMatch(/could not be read/);
    expect(validateVideoDuration(61, constraints)).toMatch(/longer/);
    expect(validateVideoDuration(60, constraints)).toBeNull();
  });
});
