import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { Env } from '../config/env.schema';
import { StorageService } from './storage.service';

function createService(overrides: Partial<Env> = {}): StorageService {
  const values: Record<string, unknown> = {
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: 'demo-key',
    CLOUDINARY_API_SECRET: 'demo-secret',
    CLOUDINARY_UPLOAD_FOLDER: 'podcast-reels',
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
          folder: 'podcast-reels',
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
          folder: 'podcast-reels',
          public_id: 'video-2',
          upload_preset: 'videos',
        },
        'demo-secret',
      ),
    );
  });

  it('never exposes the api secret', () => {
    const result = createService().createUploadSignature({
      publicId: 'video-3',
    });

    expect(JSON.stringify(result)).not.toContain('demo-secret');
  });
});
