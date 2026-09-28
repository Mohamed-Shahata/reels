import {
  clearPendingUpload,
  clearPendingUploadByVideoId,
  getFileFingerprint,
  loadPendingUpload,
  savePendingUpload,
} from '@/lib/upload-store';

describe('pending upload storage', () => {
  const file = new File(['video'], 'episode.mp4', {
    lastModified: 1_727_512_000_000,
    type: 'video/mp4',
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('restores the last completed byte only for the same file', () => {
    savePendingUpload({
      fileFingerprint: getFileFingerprint(file),
      nextByte: 20 * 1024 * 1024,
      title: 'Episode',
      uploadId: 'upload-1',
      videoId: 'video-1',
    });

    expect(loadPendingUpload(file)).toMatchObject({
      nextByte: 20 * 1024 * 1024,
      uploadId: 'upload-1',
      videoId: 'video-1',
    });
    expect(
      loadPendingUpload(
        new File(['different'], 'episode.mp4', {
          lastModified: 1_727_512_000_000,
          type: 'video/mp4',
        }),
      ),
    ).toBeNull();
  });

  it('removes a completed upload state', () => {
    savePendingUpload({
      fileFingerprint: getFileFingerprint(file),
      nextByte: 1,
      title: 'Episode',
      uploadId: 'upload-1',
      videoId: 'video-1',
    });

    clearPendingUpload(file);

    expect(loadPendingUpload(file)).toBeNull();
  });

  it('removes a pending state when its video is deleted', () => {
    savePendingUpload({
      fileFingerprint: getFileFingerprint(file),
      nextByte: 1,
      title: 'Episode',
      uploadId: 'upload-1',
      videoId: 'video-1',
    });
    const otherFile = new File(['other'], 'other.mp4', {
      lastModified: 1_727_512_000_001,
      type: 'video/mp4',
    });
    savePendingUpload({
      fileFingerprint: getFileFingerprint(otherFile),
      nextByte: 1,
      title: 'Other episode',
      uploadId: 'upload-2',
      videoId: 'video-2',
    });

    clearPendingUploadByVideoId('video-1');

    expect(loadPendingUpload(file)).toBeNull();
    expect(loadPendingUpload(otherFile)).toMatchObject({ videoId: 'video-2' });
  });
});
