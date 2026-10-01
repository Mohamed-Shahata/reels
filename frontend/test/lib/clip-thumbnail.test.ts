import { clipThumbnailUrl } from '@/lib/clip-thumbnail';

const episode =
  'https://res.cloudinary.com/demo/video/upload/v17/reelcast/uploads/u1/v1.mp4';

describe('clipThumbnailUrl', () => {
  it('cuts a 9:16 face-aware still half a second into the clip', () => {
    expect(clipThumbnailUrl(episode, 59, 187, '9:16')).toBe(
      'https://res.cloudinary.com/demo/video/upload/so_59.5,w_360,ar_9:16,c_fill,g_auto:faces,q_auto,f_jpg/v17/reelcast/uploads/u1/v1.jpg',
    );
  });

  it('builds a 16:9 still and never goes past the clip end', () => {
    expect(clipThumbnailUrl(episode, 10, 10.3, '16:9')).toContain('so_10.2,');
    expect(clipThumbnailUrl(episode, 10, 20, '16:9')).toContain('ar_16:9');
  });

  it('returns null without a Cloudinary episode URL', () => {
    expect(clipThumbnailUrl(null, 0, 5, '9:16')).toBeNull();
    expect(
      clipThumbnailUrl('https://example.com/a.mp4', 0, 5, '9:16'),
    ).toBeNull();
  });
});
