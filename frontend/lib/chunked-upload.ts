import { api, type CreateVideoUpload } from './api';

export const DEFAULT_PART_SIZE = 8 * 1024 * 1024; // 8 MB per part
export const DEFAULT_CONCURRENCY = 3;
export const MAX_RETRIES = 3;

export interface CompletedPart {
  partNumber: number;
  eTag: string;
}

export interface MultipartUploadResult {
  uploadId: string;
  storageKey: string;
  parts: CompletedPart[];
  public_id: string;
  bytes: number;
}

export interface ChunkedUploadOptions {
  videoId?: string;
  onChunkComplete?: (nextByte: number) => void;
  onProgress: (progress: number) => void;
  onRetry?: (attempt: number) => void;
  signal?: AbortSignal;
  startAt?: number;
  uploadId?: string;
  partSize?: number;
  concurrency?: number;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Upload aborted', 'AbortError'));
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Upload aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Uploads a video file using S3 multipart upload with parallel parts,
 * exponential backoff retry per part, and upload resumption support.
 */
export async function uploadVideoInChunks(
  file: File,
  upload: CreateVideoUpload['upload'],
  options: ChunkedUploadOptions,
): Promise<MultipartUploadResult> {
  const partSize = options.partSize ?? DEFAULT_PART_SIZE;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const totalParts = Math.max(1, Math.ceil(file.size / partSize));
  const uploadId = upload.uploadId ?? options.uploadId ?? '';
  const storageKey = upload.storageKey ?? upload.publicId ?? '';
  const videoId = options.videoId;

  // Track completed parts and their eTags
  const completedParts = new Map<number, string>();
  const partLoadedBytes = new Map<number, number>();

  // 1. Resume check from S3 if videoId and uploadId exist
  if (videoId && uploadId) {
    try {
      const status = await api.getUploadStatus(videoId, uploadId);
      for (const part of status.parts) {
        completedParts.set(part.partNumber, part.eTag);
        partLoadedBytes.set(part.partNumber, part.size);
      }
    } catch {
      // Resume check failed, start fresh
    }
  }

  // Pre-seed known presigned URLs from initial upload response
  const partUrlCache = new Map<number, string>();
  if (upload.parts) {
    for (const p of upload.parts) {
      partUrlCache.set(p.partNumber, p.url);
    }
  }

  // Calculate initial progress from resumed parts
  function updateProgress() {
    let totalLoaded = 0;
    for (const bytes of partLoadedBytes.values()) {
      totalLoaded += bytes;
    }
    const percent = Math.min(
      100,
      Math.round((totalLoaded / Math.max(1, file.size)) * 100),
    );
    options.onProgress(percent);
  }

  updateProgress();

  // 2. Build list of pending part numbers
  const pendingPartNumbers: number[] = [];
  for (let p = 1; p <= totalParts; p++) {
    if (!completedParts.has(p)) {
      pendingPartNumbers.push(p);
    }
  }

  // Helper to fetch missing presigned URLs in batches
  async function ensurePresignedUrl(partNumber: number): Promise<string> {
    const cached = partUrlCache.get(partNumber);
    if (cached) return cached;

    if (!videoId || !uploadId) {
      throw new Error('Cannot presign parts without videoId and uploadId');
    }

    // Presign a batch of upcoming parts starting from partNumber
    const batch: number[] = [];
    for (let p = partNumber; p < partNumber + 5 && p <= totalParts; p++) {
      if (!partUrlCache.has(p)) {
        batch.push(p);
      }
    }

    const res = await api.presignUploadParts(videoId, {
      uploadId,
      partNumbers: batch.length > 0 ? batch : [partNumber],
    });

    for (const p of res.parts) {
      partUrlCache.set(p.partNumber, p.url);
    }

    const url = partUrlCache.get(partNumber);
    if (!url) {
      throw new Error(`Failed to obtain presigned URL for part ${partNumber}`);
    }
    return url;
  }

  // Helper to upload a single part with retry
  async function uploadPartWithRetry(partNumber: number): Promise<void> {
    const startByte = (partNumber - 1) * partSize;
    const endByte = Math.min(startByte + partSize, file.size);
    const chunk = file.slice(startByte, endByte);
    const chunkSize = chunk.size;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) {
        throw new DOMException('Upload aborted', 'AbortError');
      }

      try {
        const url = await ensurePresignedUrl(partNumber);

        const response = await fetch(url, {
          method: 'PUT',
          body: chunk,
          signal: options.signal,
        });

        if (!response.ok) {
          throw new Error(`S3 upload error with HTTP status ${response.status}`);
        }

        const rawEtag =
          response.headers.get('ETag') ||
          response.headers.get('etag') ||
          `part-${partNumber}`;
        const cleanEtag = rawEtag.replace(/^"|"$/g, '');

        completedParts.set(partNumber, cleanEtag);
        partLoadedBytes.set(partNumber, chunkSize);
        updateProgress();
        options.onChunkComplete?.(endByte);
        return;
      } catch (err) {
        if (
          err instanceof DOMException &&
          err.name === 'AbortError'
        ) {
          throw err;
        }

        if (attempt >= MAX_RETRIES) {
          throw new Error(
            `Failed to upload part ${partNumber} after ${MAX_RETRIES} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        options.onRetry?.(attempt);
        const backoffMs = 500 * Math.pow(2, attempt - 1);
        await delay(backoffMs, options.signal);
      }
    }
  }

  // 3. Worker pool for parallel part uploads
  let nextQueueIndex = 0;

  async function worker(): Promise<void> {
    while (nextQueueIndex < pendingPartNumbers.length) {
      if (options.signal?.aborted) {
        throw new DOMException('Upload aborted', 'AbortError');
      }

      const currentIndex = nextQueueIndex++;
      const partNumber = pendingPartNumbers[currentIndex];
      await uploadPartWithRetry(partNumber);
    }
  }

  const workerPromises: Promise<void>[] = [];
  const activeConcurrency = Math.min(concurrency, pendingPartNumbers.length);

  for (let i = 0; i < activeConcurrency; i++) {
    workerPromises.push(worker());
  }

  await Promise.all(workerPromises);

  // 4. All parts uploaded, format result
  const sortedParts: CompletedPart[] = Array.from(completedParts.entries())
    .map(([partNumber, eTag]) => ({ partNumber, eTag }))
    .sort((a, b) => a.partNumber - b.partNumber);

  options.onProgress(100);

  return {
    uploadId,
    storageKey,
    parts: sortedParts,
    public_id: storageKey,
    bytes: file.size,
  };
}

// Kept for backward compatibility if any legacy test imports it
export async function uploadVideoToLocalServer(
  file: File,
  videoId: string,
  options: ChunkedUploadOptions,
): Promise<{ public_id: string; bytes: number }> {
  return uploadVideoInChunks(
    file,
    {
      publicId: `users/local/videos/${videoId}/source.mp4`,
      storageKey: `users/local/videos/${videoId}/source.mp4`,
    },
    options,
  );
}
