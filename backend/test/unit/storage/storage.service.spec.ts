import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import type { Env } from '../../../src/config/env.schema';
import {
  StorageService,
  UploadAssetNotReadyError,
} from '../../../src/storage/storage.service';
import { getSubtitlePreset } from '../../../src/subtitles/subtitle-style';

function createService(overrides: Partial<Env> = {}): StorageService {
  const values: Record<string, unknown> = {
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: 'demo-key',
    CLOUDINARY_API_SECRET: 'demo-secret',
    CLOUDINARY_UPLOAD_FOLDER: 'podcast-reels',
    VIDEO_ALLOWED_FORMATS: ['mp4', 'mov', 'webm'],
    VIDEO_MAX_SIZE_BYTES: 5 * 1024 * 1024 * 1024,
    VIDEO_MAX_DURATION_SEC: 4 * 60 * 60,
    ...overrides,
  };
  const config = { get: (key: string) => values[key] };

  return new StorageService(config as unknown as ConfigService<Env, true>);
}

function sign(params: Record<string, string | number>, secret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  return createHash('sha1')
    .update(payload + secret)
    .digest('hex');
}

describe('StorageService', () => {
  it('creates a valid upload signature', () => {
    const result = createService().createUploadSignature({
      publicId: 'video-1',
    });

    expect(result.signature).toBe(
      sign(
        {
          timestamp: result.timestamp,
          public_id: 'video-1',
        },
        'demo-secret',
      ),
    );
    expect(result.uploadUrl).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/video/upload',
    );
    expect(result.apiKey).toBe('demo-key');
    expect(result.resourceType).toBe('video');
    expect(result.allowedFormats).toEqual(['mp4', 'mov', 'webm']);
    expect(result.maxFileSizeBytes).toBe(5 * 1024 * 1024 * 1024);
  });

  it('includes the upload preset in the signature when configured', () => {
    const result = createService({
      CLOUDINARY_UPLOAD_PRESET: 'videos',
    }).createUploadSignature({ publicId: 'video-2' });

    expect(result.uploadPreset).toBe('videos');
    expect(result.signature).toBe(
      sign(
        {
          timestamp: result.timestamp,
          public_id: 'video-2',
          upload_preset: 'videos',
        },
        'demo-secret',
      ),
    );
  });

  it('returns a copy of the configured upload constraints', () => {
    const service = createService({ VIDEO_ALLOWED_FORMATS: ['mp4'] });
    const constraints = service.getUploadConstraints();
    constraints.allowedFormats.push('mov');

    expect(service.getUploadConstraints().allowedFormats).toEqual(['mp4']);
  });

  it('uses a stable, non-reserved public id for each uploaded video', () => {
    const service = createService();

    expect(service.getVideoPublicId('user-1', 'video-1')).toBe(
      'podcast-reels/uploads/user-1/video-1',
    );
    expect(service.getLegacyVideoPublicIds('user-1', 'video-1')).toEqual([
      'videos/user-1/video-1',
      'podcast-reels/videos/user-1/video-1',
    ]);
  });

  it('requests media metadata when verifying a video', async () => {
    const resource = jest.spyOn(cloudinary.api, 'resource').mockResolvedValue({
      public_id: 'video-4',
      bytes: 123,
      duration: 12.5,
      format: 'mp4',
    });

    await expect(createService().getVideoMetadata('video-4')).resolves.toEqual(
      expect.objectContaining({ durationSec: 12.5, format: 'mp4' }),
    );
    expect(resource).toHaveBeenCalledWith('video-4', {
      resource_type: 'video',
      media_metadata: true,
    });
    resource.mockRestore();
  });

  it('treats a video without a processed duration as not ready', async () => {
    const resource = jest.spyOn(cloudinary.api, 'resource').mockResolvedValue({
      public_id: 'video-5',
      bytes: 123,
      format: 'mp4',
    });

    await expect(
      createService().getVideoMetadata('video-5'),
    ).rejects.toBeInstanceOf(UploadAssetNotReadyError);
    resource.mockRestore();
  });

  it('builds trimmed playback and streaming download URLs', () => {
    const url = jest
      .spyOn(cloudinary, 'url')
      .mockReturnValueOnce('https://preview.example')
      .mockReturnValueOnce('https://download.example');
    const service = createService();

    expect(service.getClipPlaybackUrl('video-1', 10, 30)).toBe(
      'https://preview.example',
    );
    expect(service.getClipDownloadUrl('video-1', 10, 30, 'clip-1')).toBe(
      'https://download.example',
    );
    expect(url).toHaveBeenNthCalledWith(1, 'video-1', {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      transformation: [{ start_offset: 10, end_offset: 30 }],
    });
    expect(url).toHaveBeenNthCalledWith(2, 'video-1', {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      flags: 'streaming_attachment:clip-1',
      transformation: [{ start_offset: 10, end_offset: 30 }],
    });
    url.mockRestore();
  });

  it('builds 9:16 face-gravity reframed playback and download URLs', () => {
    const url = jest
      .spyOn(cloudinary, 'url')
      .mockReturnValueOnce('https://reel-preview.example')
      .mockReturnValueOnce('https://reel-download.example');
    const service = createService();
    const reelCrop = {
      crop: 'fill',
      aspect_ratio: '9:16',
      width: 1080,
      gravity: 'auto:faces',
    };

    expect(
      service.getClipPlaybackUrl('video-1', 10, 30, { reframe: true }),
    ).toBe('https://reel-preview.example');
    expect(
      service.getClipDownloadUrl('video-1', 10, 30, 'clip-1-9x16', {
        reframe: true,
      }),
    ).toBe('https://reel-download.example');
    expect(url).toHaveBeenNthCalledWith(1, 'video-1', {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      transformation: [{ start_offset: 10, end_offset: 30 }, reelCrop],
    });
    expect(url).toHaveBeenNthCalledWith(2, 'video-1', {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      flags: 'streaming_attachment:clip-1-9x16',
      transformation: [{ start_offset: 10, end_offset: 30 }, reelCrop],
    });
    url.mockRestore();
  });

  it('keeps the original framing when reframe is false or omitted', () => {
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');
    const service = createService();
    const trimmedOnly = {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      transformation: [{ start_offset: 10, end_offset: 30 }],
    };

    service.getClipPlaybackUrl('video-1', 10, 30, { reframe: false });
    service.getClipPlaybackUrl('video-1', 10, 30, {});

    expect(url).toHaveBeenNthCalledWith(1, 'video-1', trimmedOnly);
    expect(url).toHaveBeenNthCalledWith(2, 'video-1', trimmedOnly);
    url.mockRestore();
  });

  it('pre-generates the reel as an eager asset and returns its playback URL', async () => {
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});
    const url = jest
      .spyOn(cloudinary, 'url')
      .mockReturnValue('https://reel-preview.example');

    await expect(
      createService().startClipReelRender('video-1', 10, 30),
    ).resolves.toBe('https://reel-preview.example');

    expect(explicit).toHaveBeenCalledWith('video-1', {
      type: 'upload',
      resource_type: 'video',
      eager: [
        {
          transformation: [
            { start_offset: 10, end_offset: 30 },
            {
              crop: 'fill',
              aspect_ratio: '9:16',
              width: 1080,
              gravity: 'auto:faces',
            },
          ],
          format: 'mp4',
        },
      ],
      eager_async: true,
    });
    expect(url).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({
        format: 'mp4',
        transformation: [
          { start_offset: 10, end_offset: 30 },
          expect.objectContaining({ aspect_ratio: '9:16' }),
        ],
      }),
    );
    explicit.mockRestore();
    url.mockRestore();
  });

  it('does not return a URL when Cloudinary refuses to start the render', async () => {
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockRejectedValue(new Error('cloudinary unavailable'));

    await expect(
      createService().startClipReelRender('video-1', 10, 30),
    ).rejects.toThrow('cloudinary unavailable');
    explicit.mockRestore();
  });

  it('stores the subtitle layers as a named transformation and references it after the reframe', async () => {
    const create = jest
      .spyOn(cloudinary.api, 'create_transformation')
      .mockResolvedValue({});
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');
    const burnIn = {
      style: getSubtitlePreset('REEL').style,
      cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
    };

    await createService().startClipReelRender('video-1', 10, 30, burnIn);

    const [name, definition] = create.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(name).toMatch(/^subs_[0-9a-f]{24}$/);
    expect(definition).toContain('l_text:Cairo_51_bold_center:Hello');
    expect(definition).toContain('so_1');
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(
      explicit.mock.invocationCallOrder[0],
    );

    const transformation = (
      explicit.mock.calls[0][1] as unknown as {
        eager: { transformation: Record<string, unknown>[] }[];
      }
    ).eager[0].transformation;
    expect(transformation).toHaveLength(3);
    expect(transformation[1]).toMatchObject({ aspect_ratio: '9:16' });
    expect(transformation[2]).toEqual({ transformation: name });
    expect(url).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({ transformation }),
    );
    create.mockRestore();
    explicit.mockRestore();
    url.mockRestore();
  });

  it('keeps going when the named transformation already exists', async () => {
    const create = jest
      .spyOn(cloudinary.api, 'create_transformation')
      .mockRejectedValue({
        error: { http_code: 409, message: 'already exists' },
      });
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');

    await expect(
      createService().startClipReelRender('video-1', 10, 30, {
        style: getSubtitlePreset('REEL').style,
        cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
      }),
    ).resolves.toBe('https://x');
    create.mockRestore();
    explicit.mockRestore();
    url.mockRestore();
  });

  it('fails when the named transformation cannot be created', async () => {
    const create = jest
      .spyOn(cloudinary.api, 'create_transformation')
      .mockRejectedValue({ error: { http_code: 400, message: 'too long' } });

    await expect(
      createService().startClipReelRender('video-1', 10, 30, {
        style: getSubtitlePreset('REEL').style,
        cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
      }),
    ).rejects.toBeDefined();
    create.mockRestore();
  });

  it('gives the same name to the same subtitles and a short URL for many cues', async () => {
    const create = jest
      .spyOn(cloudinary.api, 'create_transformation')
      .mockResolvedValue({});
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});
    const cues = Array.from({ length: 120 }, (_, i) => ({
      index: i + 1,
      startSec: i * 3,
      endSec: i * 3 + 2.5,
      text: 'ازاي تكسب الناس وتقوي مهارات التواصل',
    }));
    const burnIn = { style: getSubtitlePreset('REEL').style, cues };

    await createService().startClipReelRender('video-1', 0, 360, burnIn);
    await createService().startClipReelRender('video-1', 0, 360, burnIn);

    expect(create.mock.calls[0][0]).toBe(create.mock.calls[1][0]);
    const eager = explicit.mock.calls[0][1] as unknown as {
      eager: { transformation: unknown[] }[];
    };
    expect(eager.eager[0].transformation).toHaveLength(3);
    create.mockRestore();
    explicit.mockRestore();
  });

  it('does not create a transformation for a clip without speech', async () => {
    const create = jest.spyOn(cloudinary.api, 'create_transformation');
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});

    await createService().startClipReelRender('video-1', 10, 30, {
      style: getSubtitlePreset('REEL').style,
      cues: [],
    });

    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
    explicit.mockRestore();
  });

  it('builds the same subtitled transformation for downloads', () => {
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');
    const burnIn = {
      style: getSubtitlePreset('REEL').style,
      cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
    };

    createService().getClipDownloadUrl('video-1', 10, 30, 'clip-1', {
      reframe: true,
      subtitles: burnIn,
    });

    expect(url).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({
        flags: 'streaming_attachment:clip-1',
        transformation: expect.arrayContaining([
          expect.objectContaining({
            transformation: expect.stringMatching(/^subs_/) as unknown,
          }),
        ]) as unknown,
      }),
    );
    url.mockRestore();
  });

  it('ignores subtitles when the output is not reframed', () => {
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');

    createService().getClipPlaybackUrl('video-1', 10, 30, {
      subtitles: {
        style: getSubtitlePreset('REEL').style,
        cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
      },
    });

    expect(url).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({
        transformation: [{ start_offset: 10, end_offset: 30 }],
      }),
    );
    url.mockRestore();
  });

  it('never exposes the api secret', () => {
    const result = createService().createUploadSignature({
      publicId: 'video-3',
    });

    expect(JSON.stringify(result)).not.toContain('demo-secret');
  });
});
