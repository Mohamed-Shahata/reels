export interface VideoPreview {
  durationSec: number;
  width: number;
  height: number;
  thumbnail: string | null;
}

/** Reads metadata and grabs one frame for the file card, all in the browser. */
export function readVideoPreview(file: File): Promise<VideoPreview> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const finish = (thumbnail: string | null) => {
      if (settled) return;
      settled = true;
      const preview = {
        durationSec: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        thumbnail,
      };
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      resolve(preview);
    };

    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      reject(new Error('This video metadata could not be read.'));
    };
    video.onloadedmetadata = () => {
      const target = Math.min(1, Math.max(0, video.duration / 2));
      video.currentTime = Number.isFinite(target) ? target : 0;
    };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 320 / (video.videoWidth || 320));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas
          .getContext('2d')
          ?.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.7));
      } catch {
        finish(null);
      }
    };
    // Some codecs never fire `seeked`; metadata alone is still enough.
    window.setTimeout(() => {
      if (!settled && video.readyState >= 1) finish(null);
    }, 4000);
    video.src = objectUrl;
  });
}
