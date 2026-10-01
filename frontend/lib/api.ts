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

const transcriptionStateSchema = z.enum([
  'NONE',
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);

const librarySummarySchema = libraryVideoSchema.extend({
  thumbnailUrl: z.string().nullable(),
  clipCount: z.number().int().min(0),
  reelCount: z.number().int().min(0),
  transcriptReady: z.boolean(),
  transcriptionState: transcriptionStateSchema,
  transcriptionProgress: z.number().min(0).max(100),
  failureReason: z.string().nullable(),
});

const librarySummariesSchema = z.array(librarySummarySchema);

const clipSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  title: z.string(),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  source: z.enum(['MANUAL', 'AI']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const clipsSchema = z.array(clipSchema);

const usageSchema = z.object({
  month: z.string(),
  uploadedMinutes: z.number().min(0),
  clipCount: z.number().int().min(0),
  aiRuns: z.number().int().min(0),
  aiRunLimit: z.number().int().positive(),
});
const clipUrlSchema = z.object({ url: z.url() });

const processingJobStatusSchema = z.enum([
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
]);
const processingJobTypeSchema = z.enum(['TRANSCRIPTION', 'RENDER']);

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

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const subtitleStyleSchema = z.object({
  fontFamily: z.enum(['Cairo', 'Amiri', 'Arial']),
  fontSizePx: z.number().int().positive(),
  bold: z.boolean(),
  textColor: hexColorSchema,
  backgroundColor: hexColorSchema,
  backgroundOpacity: z.number().min(0).max(1),
  position: z.enum(['TOP', 'MIDDLE', 'BOTTOM']),
  // Renders made before word-by-word subtitles existed have no mode.
  displayMode: z.enum(['PHRASE', 'WORD']).default('PHRASE'),
});

export const aiClipModeSchema = z.enum(['FULL', 'HIGHLIGHTS']);

const subtitleEditSchema = z.object({
  index: z.number().int().min(1),
  text: z.string(),
});

const subtitleCueSchema = z.object({
  index: z.number().int().min(1),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  text: z.string(),
});

const clipSubtitlesSchema = z.object({
  clipId: z.string(),
  language: z.string(),
  displayMode: z.enum(['PHRASE', 'WORD']).default('PHRASE'),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  durationSec: z.number().positive(),
  timing: z.enum(['WORD', 'ESTIMATED', 'MIXED', 'NONE']),
  cues: z.array(subtitleCueSchema),
});

const clipRenderSchema = z.object({
  id: z.string(),
  clipId: z.string(),
  status: processingJobStatusSchema,
  progress: z.number().min(0).max(100),
  attempts: z.number().int().min(0),
  error: z.string().nullable(),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
  outputUrl: z.string().nullable(),
  subtitles: z.boolean(),
  subtitleStyle: subtitleStyleSchema.nullable(),
  subtitleEdits: z.array(subtitleEditSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const clipRendersSchema = z.array(clipRenderSchema);

const transcriptSegmentSchema = z.object({
  id: z.string(),
  startSec: z.number(),
  endSec: z.number(),
  text: z.string(),
  // Optional: shown as speaker filters when the backend provides diarization.
  speaker: z.string().nullish(),
});

const transcriptSchema = z
  .object({
    id: z.string(),
    videoId: z.string(),
    language: z.string(),
    segments: z.array(transcriptSegmentSchema),
  })
  .nullable();

const subtitleStylePresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  style: subtitleStyleSchema,
});

const subtitleStyleCatalogSchema = z.object({
  defaultPresetId: z.string().min(1),
  fonts: z.array(subtitleStyleSchema.shape.fontFamily).min(1),
  positions: z.array(subtitleStyleSchema.shape.position).min(1),
  displayModes: z
    .array(subtitleStyleSchema.shape.displayMode)
    .min(1)
    .default(['PHRASE', 'WORD']),
  fontSize: z.object({
    min: z.number().int().positive(),
    max: z.number().int().positive(),
  }),
  presets: z.array(subtitleStylePresetSchema).min(1),
});

const errorSchema = z.object({
  message: z.union([z.string(), z.array(z.string())]).optional(),
  requestId: z.string().min(1).optional(),
});

export type LibrarySummary = z.infer<typeof librarySummarySchema>;
export type User = z.infer<typeof userSchema>;
export type CreateVideoUpload = z.infer<typeof createVideoSchema>;
export type UploadConstraints = z.infer<typeof uploadConstraintsSchema>;
export type LibraryVideo = z.infer<typeof libraryVideoSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Usage = z.infer<typeof usageSchema>;
export type ProcessingJob = z.infer<typeof processingJobSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type ClipRender = z.infer<typeof clipRenderSchema>;
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>;
export type SubtitleDisplayMode = SubtitleStyle['displayMode'];
export type AiClipMode = z.infer<typeof aiClipModeSchema>;
export type SubtitleEdit = z.infer<typeof subtitleEditSchema>;
export type SubtitleCue = z.infer<typeof subtitleCueSchema>;
export type ClipSubtitles = z.infer<typeof clipSubtitlesSchema>;
export type SubtitleStylePreset = z.infer<typeof subtitleStylePresetSchema>;
export type SubtitleStyleCatalog = z.infer<typeof subtitleStyleCatalogSchema>;

export interface CreateVideoOptions {
  language?: 'ar' | 'en';
  autoClips?: boolean;
}

export interface ClipUrlOptions {
  reframe?: boolean;
}

export interface RenderRequestOptions {
  subtitles: boolean;
  presetId?: string;
  style?: SubtitleStyle;
  edits?: SubtitleEdit[];
  /** Discard this clip's old subtitled renders and render again from scratch. */
  regenerate?: boolean;
}

function renderRequestBody(options: RenderRequestOptions): string {
  if (!options.subtitles) return JSON.stringify({});

  return JSON.stringify({
    subtitles: true,
    ...(options.regenerate && { regenerate: true }),
    ...(options.presetId && { preset: options.presetId }),
    ...options.style,
    ...(options.edits?.length && { subtitleEdits: options.edits }),
  });
}

function clipUrlPath(clipId: string, action: string, options: ClipUrlOptions) {
  const query = options.reframe ? '?reframe=true' : '';
  return `/clips/${clipId}/${action}${query}`;
}

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
  getLibrary: () => request('/videos/library', librarySummariesSchema),
  createVideo: (title: string, options: CreateVideoOptions = {}) =>
    request('/videos', createVideoSchema, {
      method: 'POST',
      body: JSON.stringify({ title, ...options }),
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
  createAiClips: (
    videoId: string,
    options: { confirmReplace?: boolean; mode?: AiClipMode } = {},
  ) =>
    request(`/videos/${videoId}/ai-clips`, clipsSchema, {
      method: 'POST',
      body: JSON.stringify({
        ...(options.confirmReplace && { confirmReplace: true }),
        ...(options.mode && { mode: options.mode }),
      }),
    }),
  getUsage: () => request('/usage', usageSchema),
  splitClip: (clipId: string, splitSec: number) =>
    request(`/clips/${clipId}/split`, clipsSchema, {
      method: 'POST',
      body: JSON.stringify({ splitSec }),
    }),
  mergeClips: (videoId: string, input: { clipIds: string[]; title: string }) =>
    request(`/videos/${videoId}/clips/merge`, clipSchema, {
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
  getClipPlaybackUrl: (clipId: string, options: ClipUrlOptions = {}) =>
    request(clipUrlPath(clipId, 'playback', options), clipUrlSchema),
  getClipDownloadUrl: (clipId: string, options: ClipUrlOptions = {}) =>
    request(clipUrlPath(clipId, 'download', options), clipUrlSchema),
  getVideoRenders: (videoId: string) =>
    request(`/videos/${videoId}/renders`, clipRendersSchema),
  renderClip: (
    clipId: string,
    options: RenderRequestOptions = { subtitles: false },
  ) =>
    request(`/clips/${clipId}/renders`, clipRenderSchema, {
      method: 'POST',
      body: renderRequestBody(options),
    }),
  renderAllClips: (
    videoId: string,
    options: RenderRequestOptions = { subtitles: false },
  ) =>
    request(`/videos/${videoId}/renders`, clipRendersSchema, {
      method: 'POST',
      body: renderRequestBody({ ...options, edits: undefined }),
    }),
  deleteSubtitledRenders: (videoId: string) =>
    request(
      `/videos/${videoId}/renders/subtitled`,
      z.object({ deleted: z.number() }),
      { method: 'DELETE' },
    ),
  deleteClipSubtitledRenders: (clipId: string) =>
    request(
      `/clips/${clipId}/renders/subtitled`,
      z.object({ deleted: z.number() }),
      { method: 'DELETE' },
    ),
  getRenderDownloadUrl: (renderId: string) =>
    request(`/renders/${renderId}/download`, clipUrlSchema),
  getClipSubtitles: (clipId: string, mode?: SubtitleDisplayMode) =>
    request(
      `/clips/${clipId}/subtitles${mode ? `?mode=${mode}` : ''}`,
      clipSubtitlesSchema,
    ),
  getSubtitleStyleCatalog: () =>
    request('/subtitles/styles', subtitleStyleCatalogSchema),
  retryRender: (renderId: string) =>
    request(`/renders/${renderId}/retry`, clipRenderSchema, {
      method: 'POST',
    }),
  /** Stops a render that is waiting or running; it can be resumed later. */
  stopRender: (renderId: string) =>
    request(`/renders/${renderId}/stop`, clipRenderSchema, {
      method: 'POST',
    }),
  stopClipRenders: (clipId: string) =>
    request(`/clips/${clipId}/renders/stop`, clipRendersSchema, {
      method: 'POST',
    }),
  stopVideoRenders: (videoId: string) =>
    request(`/videos/${videoId}/renders/stop`, clipRendersSchema, {
      method: 'POST',
    }),
};
