import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import type { Env } from '../config/env.schema';
import type { UploadSignature, UploadSignatureInput } from './storage.types';

@Injectable()
export class StorageService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly uploadPreset?: string;
  private readonly folder: string;

  constructor(config: ConfigService<Env, true>) {
    this.cloudName = config.get('CLOUDINARY_CLOUD_NAME', { infer: true });
    this.apiKey = config.get('CLOUDINARY_API_KEY', { infer: true });
    this.apiSecret = config.get('CLOUDINARY_API_SECRET', { infer: true });
    this.uploadPreset = config.get('CLOUDINARY_UPLOAD_PRESET', { infer: true });
    this.folder = config.get('CLOUDINARY_UPLOAD_FOLDER', { infer: true });

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
      folder: this.folder,
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
      folder: this.folder,
      resourceType: 'video',
      ...(this.uploadPreset && { uploadPreset: this.uploadPreset }),
    };
  }
}
