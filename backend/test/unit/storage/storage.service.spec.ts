import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import type { Env } from '../../../src/config/env.schema';
import {
  StorageService,
  UploadAssetNotReadyError,
} from '../../../src/storage/storage.service';

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

  it('never exposes the api secret', () => {
    const result = createService().createUploadSignature({
      publicId: 'video-3',
    });

    expect(JSON.stringify(result)).not.toContain('demo-secret');
  });
});
