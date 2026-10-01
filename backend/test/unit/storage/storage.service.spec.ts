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

  it('creates named transformations with one text layer per cue and references them', async () => {
    const createTransformation = jest
      .spyOn(cloudinary.api, 'create_transformation')
      .mockResolvedValue({});
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload')
      .mockResolvedValue({} as never);
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');
    const cues = Array.from({ length: 40 }, (_, i) => ({
      index: i + 1,
      startSec: i,
      endSec: i + 0.5,
      text: 'تتفاوض',
    }));

    await createService().startClipReelRender('video-1', 10, 60, {
      style: getSubtitlePreset('REEL').style,
      cues,
    });

    // The cues are split over several short definitions.
    expect(createTransformation.mock.calls.length).toBeGreaterThan(1);
    for (const [name, definition] of createTransformation.mock.calls) {
      expect(name).toMatch(/^reelsubs_[0-9a-f]{24}$/);
      const definitionText =
        typeof definition === 'string'
          ? definition
          : JSON.stringify(definition);
      expect(definitionText.length).toBeLessThan(2000);
      expect(definitionText).toContain('l_text:Cairo_');
      expect(definitionText).toContain('fl_layer_apply');
    }
    expect(upload).not.toHaveBeenCalled();

    const transformation = (
      explicit.mock.calls[0][1] as unknown as {
        eager: { transformation: Record<string, unknown>[] }[];
      }
    ).eager[0].transformation;
    expect(transformation[1]).toMatchObject({ aspect_ratio: '9:16' });
    expect(transformation.slice(2).map((part) => part.transformation)).toEqual(
      createTransformation.mock.calls.map(([name]) => name),
    );
    createTransformation.mockRestore();
    upload.mockRestore();
    explicit.mockRestore();
    url.mockRestore();
  });

  it('treats an already existing named transformation as created', async () => {
    const createTransformation = jest
      .spyOn(cloudinary.api, 'create_transformation')
      .mockRejectedValue({ http_code: 409, message: 'already exists' });

    await expect(
      createService().ensureSubtitleFile({
        style: getSubtitlePreset('REEL').style,
        cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
      }),
    ).resolves.toBeUndefined();
    createTransformation.mockRestore();
  });

  it('uploads the cues as an SRT file and references it after the reframe', async () => {
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload')
      .mockResolvedValue({} as never);
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');
    const burnIn = {
      style: getSubtitlePreset('REEL').style,
      cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
    };

    await createService({
      SUBTITLE_BURN_MODE: 'SRT',
    }).startClipReelRender('video-1', 10, 30, burnIn);

    const srtCall = upload.mock.calls.find((call) =>
      String((call[1] as { public_id?: string }).public_id).endsWith('.srt'),
    );
    const [data, options] = srtCall as unknown as [
      string,
      { resource_type: string; public_id: string },
    ];
    expect(options.resource_type).toBe('raw');
    expect(options.public_id).toMatch(/^reelsubs[0-9a-f]{24}\.srt$/);
    const srt = Buffer.from(data.split(',')[1], 'base64').toString('utf8');
    expect(srt).toContain('00:00:01,000 --> 00:00:02,000');
    expect(srt).toContain('Hello');
    expect(Math.max(...upload.mock.invocationCallOrder)).toBeLessThan(
      explicit.mock.invocationCallOrder[0],
    );

    const transformation = (
      explicit.mock.calls[0][1] as unknown as {
        eager: { transformation: Record<string, unknown>[] }[];
      }
    ).eager[0].transformation;
    expect(transformation).toHaveLength(4);
    expect(transformation[1]).toMatchObject({ aspect_ratio: '9:16' });
    expect(transformation[2]).toMatchObject({
      overlay: {
        resource_type: 'subtitles',
        public_id: options.public_id,
        font_family: 'Cairo',
      },
    });
    expect(transformation[3]).toMatchObject({ flags: 'layer_apply' });
    upload.mockRestore();
    explicit.mockRestore();
    url.mockRestore();
  });

  it('fails with a readable message when the subtitle file cannot be uploaded', async () => {
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload')
      .mockRejectedValue({ error: { http_code: 400, message: 'bad file' } });

    await expect(
      createService({ SUBTITLE_BURN_MODE: 'SRT' }).startClipReelRender(
        'video-1',
        10,
        30,
        {
          style: getSubtitlePreset('REEL').style,
          cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
        },
      ),
    ).rejects.toThrow('bad file (HTTP 400)');
    upload.mockRestore();
  });

  it('uses one file and a short transformation however many cues there are', async () => {
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload')
      .mockResolvedValue({} as never);
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

    const srtService = () => createService({ SUBTITLE_BURN_MODE: 'SRT' });
    await srtService().startClipReelRender('video-1', 0, 360, burnIn);
    await srtService().startClipReelRender('video-1', 0, 360, burnIn);

    const srtIds = upload.mock.calls
      .map((call) => (call[1] as unknown as { public_id: string }).public_id)
      .filter((id) => id.endsWith('.srt'));
    expect(srtIds).toHaveLength(2);
    expect(srtIds[0]).toBe(srtIds[1]);
    const eager = explicit.mock.calls[0][1] as unknown as {
      eager: { transformation: unknown[] }[];
    };
    expect(eager.eager[0].transformation).toHaveLength(4);
    upload.mockRestore();
    explicit.mockRestore();
  });

  it('uploads the Cairo font once for Cairo subtitles', async () => {
    const upload = jest
      .spyOn(cloudinary.uploader, 'upload')
      .mockResolvedValue({} as never);
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});
    const burnIn = {
      style: getSubtitlePreset('REEL').style,
      cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
    };

    const service = createService({ SUBTITLE_BURN_MODE: 'SRT' });
    await service.startClipReelRender('video-1', 0, 30, burnIn);
    await service.startClipReelRender('video-1', 0, 30, burnIn);

    const fontCalls = upload.mock.calls.filter(
      (call) => (call[1] as { public_id?: string }).public_id === 'Cairo.ttf',
    );
    expect(fontCalls).toHaveLength(1);
    expect(fontCalls[0][1]).toMatchObject({
      resource_type: 'raw',
      type: 'authenticated',
    });
    upload.mockRestore();
    explicit.mockRestore();
  });

  it('does not upload a file for a clip without speech', async () => {
    const upload = jest.spyOn(cloudinary.uploader, 'upload');
    const explicit = jest
      .spyOn(cloudinary.uploader, 'explicit')
      .mockResolvedValue({});

    await createService({ SUBTITLE_BURN_MODE: 'SRT' }).startClipReelRender(
      'video-1',
      10,
      30,
      {
        style: getSubtitlePreset('REEL').style,
        cues: [],
      },
    );

    expect(upload).not.toHaveBeenCalled();
    upload.mockRestore();
    explicit.mockRestore();
  });

  it('builds the same subtitled transformation for downloads', () => {
    const url = jest.spyOn(cloudinary, 'url').mockReturnValue('https://x');
    const burnIn = {
      style: getSubtitlePreset('REEL').style,
      cues: [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }],
    };

    createService({ SUBTITLE_BURN_MODE: 'SRT' }).getClipDownloadUrl(
      'video-1',
      10,
      30,
      'clip-1',
      {
        reframe: true,
        subtitles: burnIn,
      },
    );

    expect(url).toHaveBeenCalledWith(
      'video-1',
      expect.objectContaining({
        flags: 'streaming_attachment:clip-1',
        transformation: expect.arrayContaining([
          expect.objectContaining({
            overlay: expect.objectContaining({
              resource_type: 'subtitles',
            }) as unknown,
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
