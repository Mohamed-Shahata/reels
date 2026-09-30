import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { Env } from '../config/env.schema';
import {
  buildSubtitleOverlay,
  type SubtitleBurnIn,
} from '../subtitles/subtitle-overlay';
import type {
  ClipUrlOptions,
  UploadConstraints,
  UploadSignature,
  UploadSignatureInput,
  VideoMetadata,
} from './storage.types';

const REEL_ASPECT_RATIO = '9:16';
const REEL_WIDTH_PX = 1080;

function isAlreadyExistsError(error: unknown): boolean {
  const { error: details } = (error ?? {}) as {
    error?: { message?: string; http_code?: number };
  };
  return (
    details?.http_code === 409 || /already exists/i.test(details?.message ?? '')
  );
}

export class UploadAssetNotReadyError extends Error {
  constructor() {
    super('Uploaded asset is not available yet');
  }
}

@Injectable()
export class StorageService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly uploadPreset?: string;
  private readonly folder: string;
  private readonly constraints: UploadConstraints;

  constructor(config: ConfigService<Env, true>) {
    this.cloudName = config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    this.apiKey = config.get('CLOUDINARY_API_KEY', { infer: true });
    this.apiSecret = config.get('CLOUDINARY_API_SECRET', { infer: true });
    this.uploadPreset = config.get('CLOUDINARY_UPLOAD_PRESET', { infer: true });
    this.folder = config.get('CLOUDINARY_UPLOAD_FOLDER', { infer: true });
    this.constraints = {
      allowedFormats: config.get('VIDEO_ALLOWED_FORMATS', { infer: true }),
      maxFileSizeBytes: config.get('VIDEO_MAX_SIZE_BYTES', { infer: true }),
      maxDurationSec: config.get('VIDEO_MAX_DURATION_SEC', { infer: true }),
    };

    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
      secure: true,
    });
  }

  createUploadSignature(input: UploadSignatureInput): UploadSignature {
    const timestamp = Math.floor(Date.now() / 1000);

    const paramsToSign: Record<string, string | number> = {
      timestamp,
      public_id: input.publicId,
      ...(this.uploadPreset && { upload_preset: this.uploadPreset }),
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      this.apiSecret,
    );

    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cloudName}/video/upload`,
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      timestamp,
      signature,
      publicId: input.publicId,
      resourceType: 'video',
      ...this.getUploadConstraints(),
      ...(this.uploadPreset && { uploadPreset: this.uploadPreset }),
    };
  }

  getUploadConstraints(): UploadConstraints {
    return {
      ...this.constraints,
      allowedFormats: [...this.constraints.allowedFormats],
    };
  }

  async deleteVideo(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
      invalidate: true,
    });
  }

  getClipPlaybackUrl(
    publicId: string,
    startSec: number,
    endSec: number,
    options: ClipUrlOptions = {},
  ): string {
    return cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      transformation: this.buildClipTransformation(startSec, endSec, options),
    });
  }

  getVideoPlaybackUrl(publicId: string): string {
    return cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
    });
  }

  getAudioDownloadUrl(publicId: string): string {
    return cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'mp3',
      transformation: [
        { audio_codec: 'mp3', audio_frequency: 16000, bit_rate: '64k' },
      ],
    });
  }

  getClipDownloadUrl(
    publicId: string,
    startSec: number,
    endSec: number,
    filename: string,
    options: ClipUrlOptions = {},
  ): string {
    return cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      flags: `streaming_attachment:${filename}`,
      transformation: this.buildClipTransformation(startSec, endSec, options),
    });
  }

  async startClipReelRender(
    publicId: string,
    startSec: number,
    endSec: number,
    subtitles?: SubtitleBurnIn,
  ): Promise<string> {
    const options: ClipUrlOptions = { reframe: true, subtitles };

    if (subtitles) await this.ensureSubtitleTransformation(subtitles);

    await cloudinary.uploader.explicit(publicId, {
      type: 'upload',
      resource_type: 'video',
      eager: [
        {
          transformation: this.buildClipTransformation(
            startSec,
            endSec,
            options,
          ),
          format: 'mp4',
        },
      ],
      eager_async: true,
    });

    return this.getClipPlaybackUrl(publicId, startSec, endSec, options);
  }

  /**
   * Every cue is one text layer, so a clip with a lot of speech would build a
   * delivery URL that is too long. The layers are stored once as a named
   * transformation and the URL only carries its short name. The name comes
   * from the content, so the same subtitles always give the same name.
   */
  private getSubtitleTransformation(
    burnIn: SubtitleBurnIn,
  ): { name: string; definition: string } | null {
    const layers = buildSubtitleOverlay(burnIn, REEL_WIDTH_PX);
    if (layers.length === 0) return null;

    const definition = cloudinary.utils.generate_transformation_string({
      transformation: layers,
    });
    const hash = createHash('sha256').update(definition).digest('hex');
    return { name: `subs_${hash.slice(0, 24)}`, definition };
  }

  async ensureSubtitleTransformation(burnIn: SubtitleBurnIn): Promise<void> {
    const transformation = this.getSubtitleTransformation(burnIn);
    if (!transformation) return;

    try {
      await cloudinary.api.create_transformation(
        transformation.name,
        transformation.definition,
      );
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }

  getVideoPublicId(userId: string, videoId: string): string {
    return [this.folder, 'uploads', userId, videoId].filter(Boolean).join('/');
  }

  getLegacyVideoPublicIds(userId: string, videoId: string): string[] {
    const legacyId = `videos/${userId}/${videoId}`;
    return [legacyId, [this.folder, legacyId].filter(Boolean).join('/')];
  }

  async getVideoMetadata(publicIds: string | string[]): Promise<VideoMetadata> {
    const candidates = Array.isArray(publicIds) ? publicIds : [publicIds];

    for (const publicId of candidates) {
      try {
        return await this.getVideoMetadataByPublicId(publicId);
      } catch (error) {
        if (this.isCloudinaryNotFound(error)) continue;
        throw error;
      }
    }

    throw new UploadAssetNotReadyError();
  }

  private async getVideoMetadataByPublicId(
    publicId: string,
  ): Promise<VideoMetadata> {
    const resource = (await cloudinary.api.resource(publicId, {
      resource_type: 'video',
      media_metadata: true,
    })) as {
      bytes?: unknown;
      duration?: unknown;
      format?: unknown;
      public_id?: unknown;
    };

    if (
      resource.public_id !== publicId ||
      typeof resource.bytes !== 'number' ||
      !Number.isSafeInteger(resource.bytes) ||
      resource.bytes <= 0
    ) {
      throw new Error('Cloudinary returned invalid video metadata');
    }

    if (
      typeof resource.duration !== 'number' ||
      !Number.isFinite(resource.duration) ||
      resource.duration <= 0
    ) {
      throw new UploadAssetNotReadyError();
    }

    const format =
      typeof resource.format === 'string' ? resource.format.toLowerCase() : '';

    if (
      !this.constraints.allowedFormats.includes(format) ||
      resource.bytes > this.constraints.maxFileSizeBytes ||
      resource.duration > this.constraints.maxDurationSec
    ) {
      throw new Error('Uploaded video violates configured upload limits');
    }

    return {
      publicId: resource.public_id,
      durationSec: resource.duration,
      bytes: BigInt(resource.bytes),
      format,
    };
  }

  private buildClipTransformation(
    startSec: number,
    endSec: number,
    options: ClipUrlOptions,
  ) {
    const trim = { start_offset: startSec, end_offset: endSec };
    if (!options.reframe) return [trim];

    const reframed = [
      trim,
      {
        crop: 'fill',
        aspect_ratio: REEL_ASPECT_RATIO,
        width: REEL_WIDTH_PX,
        gravity: 'auto:faces',
      },
    ];
    if (!options.subtitles) return reframed;

    const subtitles = this.getSubtitleTransformation(options.subtitles);
    if (!subtitles) return reframed;

    return [...reframed, { transformation: subtitles.name }];
  }

  private isCloudinaryNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'http_code' in error &&
      error.http_code === 404
    );
  }
}
