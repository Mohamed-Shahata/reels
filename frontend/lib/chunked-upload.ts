import type { CreateVideoUpload } from './api';

const CHUNK_SIZE = 20 * 1024 * 1024;
const MAX_RETRIES = 3;

interface CloudinaryUploadResult {
  public_id: string;
  bytes: number;
}

export interface ChunkedUploadOptions {
  onChunkComplete?: (nextByte: number) => void;
  onProgress: (progress: number) => void;
  onRetry?: (attempt: number) => void;
  signal?: AbortSignal;
  startAt?: number;
  uploadId?: string;
}

export async function uploadVideoInChunks(
  file: File,
  upload: CreateVideoUpload['upload'],
  options: ChunkedUploadOptions,
): Promise<CloudinaryUploadResult> {
  const uploadId = options.uploadId ?? crypto.randomUUID();
  let result: CloudinaryUploadResult | undefined;

  for (
    let start = options.startAt ?? 0;
    start < file.size;
    start += CHUNK_SIZE
  ) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    result = await uploadChunkWithRetry({
      chunk: file.slice(start, end),
      end,
      fileName: file.name,
      fileSize: file.size,
      onProgress: (loaded) =>
        options.onProgress(Math.round(((start + loaded) / file.size) * 100)),
      onRetry: options.onRetry,
      signal: options.signal,
      start,
      upload,
      uploadId,
    });
    options.onChunkComplete?.(end);
  }

  options.onProgress(100);
  return (
    result ?? Promise.reject(new Error('No upload response was received.'))
  );
}

interface UploadChunkInput {
  chunk: Blob;
  end: number;
  fileName: string;
  fileSize: number;
  onProgress: (loaded: number) => void;
  onRetry?: (attempt: number) => void;
  signal?: AbortSignal;
  start: number;
  upload: CreateVideoUpload['upload'];
  uploadId: string;
}

class ChunkUploadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function uploadChunkWithRetry(
  input: UploadChunkInput,
): Promise<CloudinaryUploadResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await uploadChunk(input);
    } catch (error) {
      if (
        error instanceof DOMException ||
        !(error instanceof ChunkUploadError) ||
        !error.retryable ||
        attempt >= MAX_RETRIES
      ) {
        throw error;
      }

      input.onRetry?.(attempt + 1);
      await wait(500 * 2 ** attempt, input.signal);
    }
  }
}

function uploadChunk(input: UploadChunkInput): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', input.chunk, input.fileName);
    formData.append('api_key', input.upload.apiKey);
    formData.append('timestamp', String(input.upload.timestamp));
    formData.append('signature', input.upload.signature);
    formData.append('public_id', input.upload.publicId);
    if (input.upload.uploadPreset) {
      formData.append('upload_preset', input.upload.uploadPreset);
    }

    const abort = () => request.abort();
    input.signal?.addEventListener('abort', abort, { once: true });
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) input.onProgress(event.loaded);
    });
    request.addEventListener('load', () => {
      input.signal?.removeEventListener('abort', abort);
      if (request.status >= 200 && request.status < 300) {
        resolve(JSON.parse(request.responseText) as CloudinaryUploadResult);
        return;
      }
      const message = cloudinaryErrorMessage(request.responseText);
      reject(
        new ChunkUploadError(
          message
            ? `Cloudinary rejected this video chunk: ${message}`
            : `Cloudinary rejected this video chunk (HTTP ${request.status}).`,
          request.status >= 500 || request.status === 429,
        ),
      );
    });
    request.addEventListener('error', () => {
      input.signal?.removeEventListener('abort', abort);
      reject(
        new ChunkUploadError('The upload connection was interrupted.', true),
      );
    });
    request.addEventListener('abort', () => {
      input.signal?.removeEventListener('abort', abort);
      reject(new DOMException('Upload cancelled.', 'AbortError'));
    });

    request.open('POST', input.upload.uploadUrl);
    request.setRequestHeader(
      'Content-Range',
      `bytes ${input.start}-${input.end - 1}/${input.fileSize}`,
    );
    request.setRequestHeader('X-Unique-Upload-Id', input.uploadId);
    request.send(formData);
  });
}

function cloudinaryErrorMessage(responseText: string): string | null {
  try {
    const body = JSON.parse(responseText) as { error?: { message?: unknown } };
    return typeof body.error?.message === 'string' ? body.error.message : null;
  } catch {
    return null;
  }
}

function wait(delay: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, delay);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Upload cancelled.', 'AbortError'));
      },
      { once: true },
    );
  });
}
