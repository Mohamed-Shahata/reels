import { z } from 'zod';
import { env } from './env';

const userSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
});

const uploadSignatureSchema = z.object({
  uploadUrl: z.url(),
  cloudName: z.string(),
  apiKey: z.string(),
  timestamp: z.number(),
  signature: z.string(),
  publicId: z.string(),
  resourceType: z.literal('video'),
  allowedFormats: z.array(z.string().min(1)).min(1),
  maxFileSizeBytes: z.number().int().positive(),
  maxDurationSec: z.number().positive(),
  uploadPreset: z.string().optional(),
});

const uploadConstraintsSchema = uploadSignatureSchema.pick({
  allowedFormats: true,
  maxFileSizeBytes: true,
  maxDurationSec: true,
});

const createVideoSchema = z.object({
  video: z.object({
    id: z.string(),
    title: z.string(),
    status: z.literal('UPLOADING'),
    createdAt: z.string(),
  }),
  upload: uploadSignatureSchema,
});

const completedVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  cloudinaryId: z.string(),
  durationSec: z.number().positive(),
  sizeBytes: z.string(),
  status: z.literal('READY'),
});

const videoStatusSchema = z.enum(['UPLOADING', 'READY', 'FAILED']);

const libraryVideoSchema = z.object({
  id: z.string(),
  title: z.string(),
  cloudinaryId: z.string().nullable(),
  durationSec: z.number().positive().nullable(),
  sizeBytes: z.string().nullable(),
  status: videoStatusSchema,
  createdAt: z.string(),
});

const libraryVideosSchema = z.array(libraryVideoSchema);

const clipSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  title: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const clipsSchema = z.array(clipSchema);
const clipUrlSchema = z.object({ url: z.url() });

const processingJobStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);
const processingJobTypeSchema = z.enum(['TRANSCRIPTION']);

const processingJobSchema = z.object({
  id: z.string(),
  type: processingJobTypeSchema,
  status: processingJobStatusSchema,
  progress: z.number().min(0).max(100),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
});

const processingJobsSchema = z.array(processingJobSchema);

const transcriptSegmentSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
});

const transcriptSchema = z
  .object({
    id: z.string(),
    videoId: z.string(),
    language: z.string(),
    segments: z.array(transcriptSegmentSchema),
  })
  .nullable();

const errorSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
  requestId: z.string().min(1).optional(),
});

export type User = z.infer<typeof userSchema>;
export type CreateVideoUpload = z.infer<typeof createVideoSchema>;
export type UploadConstraints = z.infer<typeof uploadConstraintsSchema>;
export type LibraryVideo = z.infer<typeof libraryVideoSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type ProcessingJob = z.infer<typeof processingJobSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;

  return error instanceof ApiError && error.requestId
    ? `${message} Reference ID: ${error.requestId}`
    : message;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const result = errorSchema.safeParse(body);
    const message = result.success
      ? Array.isArray(result.data.message)
        ? result.data.message[0]
        : result.data.message
      : undefined;
    const requestId =
      (result.success ? result.data.requestId : undefined) ??
      response.headers?.get('x-request-id') ??
      undefined;

    throw new ApiError(
      message ?? 'Something went wrong. Please try again.',
      response.status,
      requestId,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return schema.parse(await response.json());
}

export const api = {
  getCurrentUser: () => request('/auth/me', userSchema),
  refresh: () => request('/auth/refresh', z.undefined(), { method: 'POST' }),
  login: (email: string, password: string) =>
    request('/auth/login', userSchema, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string) =>
    request('/auth/register', userSchema, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request('/auth/logout', z.undefined(), { method: 'POST' }),
  getVideoUploadConstraints: () =>
    request('/videos/upload-constraints', uploadConstraintsSchema),
  getVideos: () => request('/videos', libraryVideosSchema),
  createVideo: (title: string) =>
    request('/videos', createVideoSchema, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  getVideoUploadSignature: (videoId: string) =>
    request(`/videos/${videoId}/upload-signature`, uploadSignatureSchema, {
      method: 'POST',
    }),
  completeVideo: (videoId: string, publicId?: string) =>
    request(`/videos/${videoId}/complete`, completedVideoSchema, {
      method: 'POST',
      body: JSON.stringify(publicId ? { publicId } : {}),
    }),
  renameVideo: (videoId: string, title: string) =>
    request(`/videos/${videoId}`, libraryVideoSchema, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  deleteVideo: (videoId: string) =>
    request(`/videos/${videoId}`, z.undefined(), { method: 'DELETE' }),
  getClips: (videoId: string) =>
    request(`/videos/${videoId}/clips`, clipsSchema),
  createClip: (
    videoId: string,
    input: { title: string; startSec: number; endSec: number },
  ) =>
    request(`/videos/${videoId}/clips`, clipSchema, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateClip: (
    clipId: string,
    input: Partial<{ title: string; startSec: number; endSec: number }>,
  ) =>
    request(`/clips/${clipId}`, clipSchema, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteClip: (clipId: string) =>
    request(`/clips/${clipId}`, z.undefined(), { method: 'DELETE' }),
  getVideoPlaybackUrl: (videoId: string) =>
    request(`/videos/${videoId}/playback`, clipUrlSchema),
  getVideoProcessingJobs: (videoId: string) =>
    request(`/videos/${videoId}/processing`, processingJobsSchema),
  getVideoTranscript: (videoId: string) =>
    request(`/videos/${videoId}/transcript`, transcriptSchema),
  startTranscription: (videoId: string) =>
    request(`/videos/${videoId}/transcribe`, processingJobSchema, {
      method: 'POST',
    }),
  getClipPlaybackUrl: (clipId: string) =>
    request(`/clips/${clipId}/playback`, clipUrlSchema),
  getClipDownloadUrl: (clipId: string) =>
    request(`/clips/${clipId}/download`, clipUrlSchema),
};
