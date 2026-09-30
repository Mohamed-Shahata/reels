import type { SubtitleBurnIn } from '../subtitles/subtitle-overlay';

export interface UploadSignatureInput {
  publicId: string;
}

export interface UploadSignature {
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  publicId: string;
  resourceType: 'video';
  allowedFormats: string[];
  maxFileSizeBytes: number;
  maxDurationSec: number;
  uploadPreset?: string;
}

export interface UploadConstraints {
  allowedFormats: string[];
  maxFileSizeBytes: number;
  maxDurationSec: number;
}

export interface VideoMetadata {
  bytes: bigint;
  durationSec: number;
  format: string;
  publicId: string;
}

export interface ClipUrlOptions {
  reframe?: boolean;
  /** Burned in only on reframed output, where the style sizes are calibrated. */
  subtitles?: SubtitleBurnIn;
}
