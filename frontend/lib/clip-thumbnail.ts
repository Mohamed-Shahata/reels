export type ThumbnailAspect = '9:16' | '16:9';

const CLOUDINARY_VIDEO =
  /^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)\.[a-z0-9]+(\?.*)?$/i;

/**
 * Builds a still-frame URL for a clip from the episode's delivery URL.
 * Cloudinary cuts one frame at the clip start, so this is a small JPEG
 * (not a video encode), it needs no render, and the CDN caches it.
 * Returns null when the episode URL is not a Cloudinary video URL.
 */
export function clipThumbnailUrl(
  episodeUrl: string | null,
  startSec: number,
  endSec: number,
  aspect: ThumbnailAspect,
): string | null {
  if (!episodeUrl) return null;
  const match = CLOUDINARY_VIDEO.exec(episodeUrl);
  if (!match) return null;

  const [, base, path] = match;
  const offset = Math.max(0, Math.min(startSec + 0.5, endSec - 0.1));
  const size =
    aspect === '9:16'
      ? 'w_360,ar_9:16,c_fill,g_auto:faces'
      : 'w_640,ar_16:9,c_fill,g_auto';

  return `${base}so_${offset.toFixed(1)},${size},q_auto,f_jpg/${path}.jpg`;
}
