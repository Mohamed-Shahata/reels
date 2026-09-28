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
  folder: string;
  resourceType: 'video';
  uploadPreset?: string;
}
