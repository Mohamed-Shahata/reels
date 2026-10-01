import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { toError } from '../common/errors/describe-error';
import type { Env } from '../config/env.schema';
import {
  buildSubtitleFileLayers,
  buildSubtitleOverlay,
  buildSubtitleSrt,
  DEFAULT_SUBTITLE_BOX_MODE,
  type OverlayComponent,
  type SubtitleBoxMode,
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

// Fonts Cloudinary does not ship. A subtitles layer that names a font it does
// not have falls back to one without Arabic letters and draws empty boxes, so
// these files are uploaded once as private custom fonts. Cloudinary matches a
// custom font by public id, which must equal the family name plus extension.
const CUSTOM_SUBTITLE_FONTS = ['Cairo', 'Amiri'];

// Each named transformation holds a few cues, so no single definition grows
// past what Cloudinary accepts, and the delivery URL only lists short names.
const SUBTITLE_CHUNK_MAX_CHARS = 1500;

interface SubtitleChunk {
  name: string;
  definition: string;
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
  private readonly logger = new Logger(StorageService.name);
  private readonly fontUploads = new Map<string, Promise<void>>();
  private readonly createdTransformations = new Set<string>();
  private readonly subtitleMode: 'LAYERS' | 'SRT';
  private readonly subtitleBoxMode: SubtitleBoxMode;

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

    this.subtitleMode =
      config.get('SUBTITLE_BURN_MODE', { infer: true }) ?? 'LAYERS';
    this.subtitleBoxMode =
      config.get('SUBTITLE_BOX_MODE', { infer: true }) ??
      DEFAULT_SUBTITLE_BOX_MODE;

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

  getVideoThumbnailUrl(publicId: string): string {
    return cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'jpg',
      transformation: [
        {
          start_offset: '1',
          width: 640,
          height: 360,
          crop: 'fill',
          gravity: 'auto',
          quality: 'auto',
        },
      ],
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

    if (subtitles) await this.ensureSubtitleFile(subtitles);

    try {
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
    } catch (error) {
      let transformation = '';
      try {
        transformation = cloudinary.utils.generate_transformation_string({
          transformation: this.buildClipTransformation(
            startSec,
            endSec,
            options,
          ),
        });
      } catch {
        // The transformation itself could not be built; the original error is enough.
      }
      throw toError(
        error,
        `Cloudinary rejected the render request${transformation ? ` [${transformation}]` : ''}`,
      );
    }

    const url = this.getClipPlaybackUrl(publicId, startSec, endSec, options);
    if (subtitles && this.subtitleMode === 'LAYERS') {
      this.logger.log(
        `Reel render started: ${subtitles.cues.length} cues, ${this.getSubtitleChunks(subtitles).length} subtitle transformations, URL ${url.length} characters (box mode ${this.subtitleBoxMode})`,
      );
    }
    return url;
  }

  /**
   * Removes the already rendered copy of a reel from Cloudinary (and its CDN
   * cache). Without this, rendering the same clip with the same subtitles
   * again would just return the old, cached video. Never throws: a copy that
   * does not exist is simply nothing to delete.
   */
  async deleteClipReelRender(
    publicId: string,
    startSec: number,
    endSec: number,
    subtitles?: SubtitleBurnIn,
  ): Promise<void> {
    try {
      const transformation = cloudinary.utils.generate_transformation_string({
        transformation: this.buildClipTransformation(startSec, endSec, {
          reframe: true,
          subtitles,
        }),
      });
      await cloudinary.api.delete_derived_by_transformation(
        [publicId],
        [transformation],
        { resource_type: 'video', invalidate: true },
      );
    } catch (error) {
      this.logger.warn(
        `Could not delete the old render: ${toError(error, 'delete failed').message}`,
      );
    }
  }

  /**
   * The cues are stored once as a small SRT file and the video references it
   * with a subtitles overlay, so the delivery URL stays short however much is
   * said. (One text layer per cue made the transformation string exceed
   * Cloudinary's limit.) The file name comes from the content, so the same
   * cues always map to the same file.
   */
  private getSubtitleFile(
    burnIn: SubtitleBurnIn,
  ): { publicId: string; content: string } | null {
    const content = buildSubtitleSrt(burnIn.cues);
    if (!content) return null;

    const hash = createHash('sha256').update(content).digest('hex');
    // Plain id: no folder and no "_" or "-". Cloudinary reads the part of a
    // subtitles layer before the first ":" as "<font>_<size>", so an id with an
    // underscore ("subs_...") was rejected as an invalid "subs" parameter.
    const publicId = `reelsubs${hash.slice(0, 24)}.srt`;
    return { publicId, content };
  }

  /** Uploads a bundled font once per process; never blocks a render. */
  private ensureSubtitleFont(family: string): Promise<void> {
    if (!CUSTOM_SUBTITLE_FONTS.includes(family)) return Promise.resolve();

    const existing = this.fontUploads.get(family);
    if (existing) return existing;

    const upload = (async () => {
      const filePath = join(process.cwd(), 'assets', 'fonts', `${family}.ttf`);
      if (!existsSync(filePath)) {
        this.logger.warn(`Font file ${filePath} is missing`);
        return;
      }
      await cloudinary.uploader.upload(filePath, {
        resource_type: 'raw',
        type: 'authenticated',
        public_id: `${family}.ttf`,
        overwrite: false,
        invalidate: false,
      });
    })().catch((error: unknown) => {
      this.fontUploads.delete(family);
      this.logger.warn(
        `Could not upload the ${family} subtitle font: ${toError(error, 'upload failed').message}`,
      );
    });

    this.fontUploads.set(family, upload);
    return upload;
  }

  /**
   * Makes sure everything the subtitles need exists on Cloudinary before a
   * render or a download URL is requested: the bundled font plus either the
   * named transformations (LAYERS) or the SRT file (SRT).
   */
  async ensureSubtitleFile(burnIn: SubtitleBurnIn): Promise<void> {
    if (this.subtitleMode === 'LAYERS') {
      await this.ensureSubtitleTransformations(burnIn);
      return;
    }

    const file = this.getSubtitleFile(burnIn);
    if (!file) return;

    await this.ensureSubtitleFont(burnIn.style.fontFamily);

    try {
      await cloudinary.uploader.upload(
        `data:text/plain;base64,${Buffer.from(file.content, 'utf8').toString('base64')}`,
        {
          resource_type: 'raw',
          public_id: file.publicId,
          overwrite: true,
          invalidate: false,
        },
      );
    } catch (error) {
      throw toError(error, 'Could not upload the subtitle file');
    }
  }

  /**
   * One text layer per cue, grouped into named transformations. Cloudinary
   * draws a text layer with the real font metrics, so Arabic words are never
   * cut off the way they were in a subtitles (SRT) layer.
   */
  private getSubtitleChunks(burnIn: SubtitleBurnIn): SubtitleChunk[] {
    const components = buildSubtitleOverlay(
      burnIn,
      REEL_WIDTH_PX,
      this.subtitleBoxMode,
    );
    const chunks: SubtitleChunk[] = [];
    let current: string[] = [];
    let currentLength = 0;

    const flush = () => {
      if (current.length === 0) return;
      const definition = current.join('/');
      const hash = createHash('sha256').update(definition).digest('hex');
      chunks.push({
        name: `reelsubs_${hash.slice(0, 24)}`,
        definition,
      });
      current = [];
      currentLength = 0;
    };

    // Components come in pairs: the text layer and its placement and timing.
    for (let i = 0; i < components.length; i += 2) {
      const pair: OverlayComponent[] = components.slice(i, i + 2);
      const text = cloudinary.utils.generate_transformation_string({
        transformation: pair,
      });
      if (
        current.length > 0 &&
        currentLength + text.length > SUBTITLE_CHUNK_MAX_CHARS
      ) {
        flush();
      }
      current.push(text);
      currentLength += text.length + 1;
    }
    flush();
    return chunks;
  }

  private async ensureSubtitleTransformations(
    burnIn: SubtitleBurnIn,
  ): Promise<void> {
    for (const chunk of this.getSubtitleChunks(burnIn)) {
      if (this.createdTransformations.has(chunk.name)) continue;
      try {
        await cloudinary.api.create_transformation(
          chunk.name,
          chunk.definition,
        );
      } catch (error) {
        // 409 means the same transformation already exists, which is fine.
        if (!this.isCloudinaryConflict(error)) {
          throw toError(error, 'Could not create the subtitle transformation');
        }
      }
      this.createdTransformations.add(chunk.name);
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

    if (this.subtitleMode === 'LAYERS') {
      return [
        ...reframed,
        ...this.getSubtitleChunks(options.subtitles).map((chunk) => ({
          transformation: chunk.name,
        })),
      ];
    }

    const file = this.getSubtitleFile(options.subtitles);
    if (!file) return reframed;

    return [
      ...reframed,
      ...buildSubtitleFileLayers(
        options.subtitles.style,
        file.publicId,
        REEL_WIDTH_PX,
      ),
    ];
  }

  private isCloudinaryConflict(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const code =
      'http_code' in error
        ? error.http_code
        : 'error' in error &&
            typeof error.error === 'object' &&
            error.error !== null &&
            'http_code' in error.error
          ? error.error.http_code
          : undefined;
    return code === 409;
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
