import type { Response } from 'express';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  ContentType,
  JobStatus,
  VideoStatus,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { S3StorageService } from '../storage/s3-storage.service';
import {
  MediaAssetService,
  buildAssetStorageKey,
} from '../storage/media-asset.service';
import { ProcessingJobsService } from '../processing/processing-jobs.service';
import type { CompleteVideoDto } from './dto/complete-video.dto';

const createdVideoSelect = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
} as const;

const readyVideoSelect = {
  id: true,
  title: true,
  durationSec: true,
  sizeBytes: true,
  status: true,
} as const;

const libraryVideoSelect = {
  id: true,
  title: true,
  durationSec: true,
  sizeBytes: true,
  status: true,
  createdAt: true,
} as const;

const librarySummarySelect = {
  ...libraryVideoSelect,
  transcript: { select: { id: true } },
  clips: {
    select: { renders: { select: { outputUrl: true } } },
  },
  processingJobs: {
    where: { type: 'TRANSCRIBE' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { status: true, progress: true, lastError: true },
  },
} as const;

export type TranscriptionState = 'NONE' | JobStatus;

export interface LibraryVideoSummary extends LibraryVideo {
  thumbnailUrl: string | null;
  clipCount: number;
  reelCount: number;
  transcriptReady: boolean;
  transcriptionState: TranscriptionState;
  transcriptionProgress: number;
  failureReason: string | null;
}

export interface CreatedVideo {
  id: string;
  title: string;
  status: VideoStatus;
  createdAt: Date;
}

export interface CompletedVideo {
  id: string;
  title: string;
  durationSec: number;
  sizeBytes: string;
  status: 'READY';
}

export interface LibraryVideo {
  id: string;
  title: string;
  durationSec: number | null;
  sizeBytes: string | null;
  status: VideoStatus;
  createdAt: Date;
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobsService: ProcessingJobsService,
    private readonly s3?: S3StorageService,
    private readonly mediaAssets?: MediaAssetService,
  ) {}

  async createUpload(
    userId: string,
    title: string,
    options: {
      language?: string;
      autoClips?: boolean;
      contentType?: ContentType;
      filename?: string;
      contentTypeHeader?: string;
      sizeBytes?: number;
    } = {},
  ): Promise<{
    video: CreatedVideo;
    upload: Record<string, unknown>;
  }> {
    const allowedFormats = ['mp4', 'mov', 'webm', 'mkv'];

    if (options.filename) {
      const ext = options.filename.split('.').pop()?.toLowerCase();
      if (!ext || !allowedFormats.includes(ext)) {
        throw new BadRequestException(
          `Unsupported video format. Allowed formats: ${allowedFormats.join(', ')}`,
        );
      }
    }

    const maxSizeBytes = 5 * 1024 * 1024 * 1024; // 5 GB
    if (options.sizeBytes && options.sizeBytes > maxSizeBytes) {
      throw new BadRequestException('Video file exceeds maximum allowed size');
    }

    // 1. Check concurrent videos limit
    const MAX_CONCURRENT_VIDEOS = 3;
    const activeVideosCount =
      (await this.prisma.video?.count?.({
        where: {
          userId,
          status: { in: ['UPLOADING', 'PROCESSING'] },
        },
      })) ?? 0;
    if (activeVideosCount >= MAX_CONCURRENT_VIDEOS) {
      throw new ConflictException(
        `Concurrent video processing limit reached (${MAX_CONCURRENT_VIDEOS}). Please wait for active videos to finish processing.`,
      );
    }

    // 2. Check storage quota
    const STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB quota per user
    const userAssets =
      (await this.prisma.mediaAsset?.findMany?.({
        where: { userId },
        select: { sizeBytes: true },
      })) ?? [];
    const totalStorageUsed = userAssets.reduce(
      (sum, a) => sum + (Number(a.sizeBytes) || 0),
      0,
    );
    const incomingSize = options.sizeBytes || 0;
    if (totalStorageUsed + incomingSize > STORAGE_QUOTA_BYTES) {
      throw new ConflictException(
        `Storage quota exceeded. Used ${Math.round(totalStorageUsed / (1024 * 1024))}MB of ${Math.round(STORAGE_QUOTA_BYTES / (1024 * 1024))}MB. Delete older videos or renders to free up storage.`,
      );
    }

    const video = await this.prisma.video.create({
      data: {
        userId,
        title,
        ...(options.contentType ? { contentType: options.contentType } : {}),
        ...(options.language ? { language: options.language } : {}),
        ...(options.autoClips !== undefined
          ? { autoClips: options.autoClips }
          : {}),
      },
      select: createdVideoSelect,
    });

    const cleanExt = options.filename
      ? options.filename.split('.').pop()?.toLowerCase() || 'mp4'
      : 'mp4';

    const storageKey = buildAssetStorageKey({
      userId,
      videoId: video.id,
      kind: 'SOURCE',
      ext: cleanExt,
    });

    let s3UploadId: string | undefined;
    let s3Parts: Array<{ partNumber: number; url: string }> = [];

    if (this.s3 && this.mediaAssets) {
      const { uploadId } = await this.s3.createMultipart(
        storageKey,
        options.contentTypeHeader ?? 'video/mp4',
      );
      s3UploadId = uploadId;

      await this.mediaAssets.register(this.prisma, {
        userId,
        videoId: video.id,
        kind: 'SOURCE',
        storageKey,
        sizeBytes: options.sizeBytes,
        contentType: options.contentTypeHeader ?? 'video/mp4',
        status: 'PENDING',
      });

      s3Parts = await Promise.all(
        [1, 2, 3, 4, 5].map(async (partNumber) => ({
          partNumber,
          url: await this.s3!.presignPart(storageKey, uploadId, partNumber),
        })),
      );
    }

    return {
      video,
      upload: {
        ...(s3UploadId && { uploadId: s3UploadId }),
        storageKey,
        parts: s3Parts,
        allowedFormats: ['mp4', 'mov', 'webm', 'mkv'],
        maxFileSizeBytes: 1024 * 1024 * 1024,
        maxDurationSec: 3600,
      },
    };
  }

  async getUploadStatus(
    userId: string,
    videoId: string,
    providedUploadId?: string,
  ): Promise<{
    videoId: string;
    uploadId: string;
    storageKey: string;
    parts: Array<{ partNumber: number; eTag: string; size: number }>;
  }> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true, status: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    if (!this.s3) {
      throw new BadRequestException('S3 storage service is not configured');
    }

    const sourceAsset = await this.prisma.mediaAsset.findFirst({
      where: { videoId, kind: 'SOURCE' },
      select: { storageKey: true },
    });

    if (!sourceAsset) {
      throw new NotFoundException('Source media asset was not found');
    }

    const storageKey = sourceAsset.storageKey;
    const uploadId =
      providedUploadId ?? (await this.s3.findActiveMultipartUpload(storageKey));

    if (!uploadId) {
      throw new NotFoundException('No active upload found for this video');
    }

    const uploadedParts = await this.s3.listParts(storageKey, uploadId);

    return {
      videoId: video.id,
      uploadId,
      storageKey,
      parts: uploadedParts.map((p) => ({
        partNumber: p.partNumber,
        eTag: p.etag,
        size: p.size,
      })),
    };
  }

  async presignParts(
    userId: string,
    videoId: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<{ parts: Array<{ partNumber: number; url: string }> }> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    if (!this.s3) {
      throw new BadRequestException('S3 storage service is not configured');
    }

    const sourceAsset = await this.prisma.mediaAsset.findFirst({
      where: { videoId, kind: 'SOURCE' },
      select: { storageKey: true },
    });

    if (!sourceAsset) {
      throw new NotFoundException('Source media asset was not found');
    }

    const storageKey = sourceAsset.storageKey;
    const parts = await Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await this.s3!.presignPart(storageKey, uploadId, partNumber),
      })),
    );

    return { parts };
  }

  getUploadConstraints() {
    return {
      allowedFormats: ['mp4', 'mov', 'webm', 'mkv'],
      maxFileSizeBytes: 5 * 1024 * 1024 * 1024,
      maxDurationSec: 14400,
    };
  }

  async list(userId: string): Promise<LibraryVideo[]> {
    const videos = await this.prisma.video.findMany({
      where: { userId, deletedAt: null, status: { not: 'DELETING' } },
      orderBy: { createdAt: 'desc' },
      select: libraryVideoSelect,
    });

    return videos.map((video) => this.serializeLibraryVideo(video));
  }

  async listLibrary(userId: string): Promise<LibraryVideoSummary[]> {
    const videos = await this.prisma.video.findMany({
      where: { userId, deletedAt: null, status: { not: 'DELETING' } },
      orderBy: { createdAt: 'desc' },
      select: librarySummarySelect,
    });

    return videos.map((video) => {
      const { transcript, clips, processingJobs, ...base } = video;
      const job = processingJobs[0];
      const transcriptReady = transcript !== null;
      const reelCount = clips.reduce(
        (total, clip) =>
          total + clip.renders.filter((render) => render.outputUrl).length,
        0,
      );
      let failureReason: string | null = null;
      if (base.status === 'FAILED') {
        failureReason = 'Upload could not be verified. Retry the upload.';
      } else if (job?.status === 'FAILED') {
        failureReason = job.lastError ?? 'Transcription failed.';
      }

      return {
        ...this.serializeLibraryVideo(base),
        thumbnailUrl:
          base.status === 'READY'
            ? `/api/v1/videos/${base.id}/thumbnail`
            : null,
        clipCount: clips.length,
        reelCount,
        transcriptReady,
        transcriptionState: transcriptReady
          ? 'COMPLETED'
          : (job?.status ?? 'NONE'),
        transcriptionProgress: job?.progress ?? 0,
        failureReason,
      };
    });
  }

  async getPlaybackUrl(userId: string, videoId: string): Promise<string> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: { in: ['READY', 'UPLOADED'] } },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    if (this.mediaAssets && this.prisma.mediaAsset) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: { videoId, kind: 'SOURCE' },
      });
      if (asset) {
        return this.mediaAssets.signedUrl(asset.storageKey, 3600);
      }
    }

    throw new NotFoundException('Video playback not available');
  }

  async getProcessingJobs(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    return this.prisma.processingJob.findMany({
      where: { videoId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        progress: true,
        errorCode: true,
        lastError: true,
        attempt: true,
        maxAttempts: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
        events: {
          orderBy: { at: 'asc' },
          select: {
            id: true,
            at: true,
            level: true,
            message: true,
            data: true,
          },
        },
      },
    });
  }

  async findOne(userId: string, id: string) {
    const video = await this.prisma.video.findFirst({
      where: {
        id,
        userId,
        deletedAt: null,
        status: { not: 'DELETING' },
      },
      include: {
        mediaAssets: {
          where: { status: 'READY' },
          select: { kind: true, storageKey: true },
        },
        processingJobs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            type: true,
            status: true,
            progress: true,
            errorCode: true,
            lastError: true,
          },
        },
      },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    const stages: Array<'INGEST' | 'TRANSCRIBE' | 'SEGMENT' | 'ANALYZE'> = [
      'INGEST',
      'TRANSCRIBE',
      'SEGMENT',
      'ANALYZE',
    ];

    const pipeline = stages.map((stage) => {
      const stageJob = video.processingJobs.find((j) => j.type === stage);
      if (stageJob) {
        return {
          stage,
          status: stageJob.status,
          progress: stageJob.progress,
          errorCode: stageJob.errorCode,
          jobId: stageJob.id,
        };
      }
      return {
        stage,
        status: 'PENDING',
        progress: 0,
        errorCode: null,
        jobId: null,
      };
    });

    const { processingJobs: _processingJobs, ...videoData } = video;
    return {
      ...videoData,
      sizeBytes: video.sizeBytes ? video.sizeBytes.toString() : null,
      pipeline,
    };
  }

  async startTranscription(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: { in: ['READY', 'UPLOADED'] } },
      select: { id: true, language: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found or is not ready');
    }

    return this.jobsService.createJob({
      userId,
      videoId,
      type: 'TRANSCRIBE',
      payload: { language: video.language ?? 'ar' },
    });
  }

  async getTranscript(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    const transcript = await this.prisma.transcript.findUnique({
      where: { videoId },
      include: {
        segments: {
          orderBy: { startSec: 'asc' },
          select: {
            id: true,
            startSec: true,
            endSec: true,
            text: true,
            speaker: true,
          },
        },
      },
    });

    return transcript;
  }

  async exportTranscript(
    userId: string,
    videoId: string,
    format: 'srt' | 'vtt' | 'txt',
  ): Promise<{ content: string; filename: string; contentType: string }> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true, title: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    const transcript = await this.prisma.transcript.findUnique({
      where: { videoId },
      include: {
        segments: {
          orderBy: { startSec: 'asc' },
          select: {
            id: true,
            startSec: true,
            endSec: true,
            text: true,
            speaker: true,
          },
        },
      },
    });

    if (!transcript || transcript.segments.length === 0) {
      throw new NotFoundException('Transcript was not found for this video');
    }

    const sanitizedTitle =
      video.title
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || `video-${videoId}`;

    const filename = `${sanitizedTitle}.${format}`;
    const { content, contentType } = formatTranscriptFile(
      transcript.segments,
      format,
    );

    return { content, filename, contentType };
  }

  async getReframePlan(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: {
        id: videoId,
        userId,
        deletedAt: null,
        status: { not: 'DELETING' },
      },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    const reframePlan = await this.prisma.reframePlan.findUnique({
      where: { videoId },
    });

    if (!reframePlan) {
      throw new NotFoundException('Reframe plan was not found');
    }

    return reframePlan;
  }

  async rename(
    userId: string,
    videoId: string,
    title: string,
  ): Promise<LibraryVideo> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    const updated = await this.prisma.video.update({
      where: { id: video.id },
      data: { title },
      select: libraryVideoSelect,
    });

    return this.serializeLibraryVideo(updated);
  }

  async remove(userId: string, videoId: string): Promise<void> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, deletedAt: null },
      select: { id: true, userId: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    if (this.prisma.$transaction) {
      await this.prisma.$transaction(async (tx) => {
        await tx.video.update({
          where: { id: video.id },
          data: {
            status: 'DELETING',
            deletedAt: new Date(),
          },
        });

        await tx.processingJob?.updateMany({
          where: {
            videoId: video.id,
            status: { in: ['QUEUED', 'RUNNING', 'RETRYING'] },
          },
          data: {
            status: 'CANCELLED',
          },
        });

        await tx.mediaAsset?.updateMany({
          where: {
            videoId: video.id,
            status: { not: 'DELETED' },
          },
          data: {
            status: 'DELETING',
          },
        });

        await this.jobsService.enqueue(tx, {
          userId: video.userId,
          videoId: video.id,
          type: 'CLEANUP',
          payload: { videoId: video.id, userId: video.userId },
          maxAttempts: 10,
        });
      });
    } else {
      await this.prisma.video.delete({ where: { id: video.id } });
    }
  }

  async resumeUpload(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: { in: ['UPLOADING', 'FAILED'] } },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Upload was not found');
    }

    await this.prisma.video.updateMany({
      where: { id: video.id, userId, status: 'FAILED' },
      data: { status: 'UPLOADING' },
    });

    return { videoId: video.id };
  }

  async completeUpload(
    userId: string,
    videoId: string,
    dtoOrPublicId?: CompleteVideoDto | string,
  ): Promise<CompletedVideo> {
    const completeDto: CompleteVideoDto =
      typeof dtoOrPublicId === 'string'
        ? { publicId: dtoOrPublicId }
        : (dtoOrPublicId ?? {});

    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: {
        id: true,
        status: true,
        durationSec: true,
        sizeBytes: true,
        title: true,
      },
    });

    if (!video) {
      throw new NotFoundException('Upload was not found');
    }

    if (
      (video.status === 'READY' || video.status === 'UPLOADED') &&
      video.sizeBytes
    ) {
      return {
        id: video.id,
        title: video.title,
        durationSec: video.durationSec ?? 0,
        sizeBytes: video.sizeBytes.toString(),
        status: 'READY',
      };
    }

    // S3 multipart completion
    const sourceAsset = await this.prisma.mediaAsset?.findFirst({
      where: { videoId, kind: 'SOURCE' },
    });

    if (
      this.s3 &&
      this.mediaAssets &&
      sourceAsset &&
      (completeDto.uploadId || completeDto.parts)
    ) {
      const storageKey = sourceAsset.storageKey;
      const uploadId =
        completeDto.uploadId ??
        (await this.s3.findActiveMultipartUpload(storageKey));

      if (!uploadId) {
        throw new BadRequestException(
          'Active uploadId is required to complete multipart upload',
        );
      }

      let partsToComplete = completeDto.parts?.map((p) => ({
        partNumber: p.partNumber,
        etag: p.eTag,
      }));

      if (!partsToComplete || partsToComplete.length === 0) {
        const listedParts = await this.s3.listParts(storageKey, uploadId);
        partsToComplete = listedParts.map((p) => ({
          partNumber: p.partNumber,
          etag: p.etag,
        }));
      }

      await this.s3.completeMultipart(storageKey, uploadId, partsToComplete);
      const head = await this.s3.head(storageKey);
      if (!head) {
        throw new BadRequestException('Uploaded video not found on storage');
      }

      const completed = await this.prisma.$transaction(async (tx) => {
        const updatedVideo = await tx.video.update({
          where: { id: video.id },
          data: {
            sizeBytes: BigInt(head.contentLength),
            status: 'UPLOADED',
          },
          select: readyVideoSelect,
        });

        await this.mediaAssets!.markReady(tx, sourceAsset.id, {
          sizeBytes: head.contentLength,
          contentType: head.contentType,
        });

        await this.jobsService.enqueue(tx, {
          userId,
          videoId: video.id,
          type: 'INGEST',
          payload: { storageKey },
        });

        return updatedVideo;
      });

      return {
        id: completed.id,
        title: completed.title,
        durationSec: completed.durationSec ?? 0,
        sizeBytes: completed.sizeBytes!.toString(),
        status: 'READY',
      };
    }

    throw new BadRequestException('Uploaded video could not be verified');
  }

  async serveThumbnail(id: string, res: Response): Promise<void> {
    if (this.mediaAssets) {
      const posterAsset = await this.prisma.mediaAsset.findFirst({
        where: { videoId: id, kind: 'POSTER', status: 'READY' },
      });
      if (posterAsset) {
        const url = await this.mediaAssets.signedUrl(posterAsset.id, 300);
        return res.redirect(302, url);
      }
    }

    throw new NotFoundException('Video was not found');
  }

  private serializeLibraryVideo(video: {
    id: string;
    title: string;
    durationSec: number | null;
    sizeBytes: bigint | null;
    status: VideoStatus;
    createdAt: Date;
  }): LibraryVideo {
    return {
      ...video,
      sizeBytes: video.sizeBytes ? video.sizeBytes.toString() : null,
    };
  }

  private async recordUsage(
    userId: string,
    durationSec: number,
    clipCount: number,
  ) {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    await this.prisma.usageRecord.upsert({
      where: {
        userId_monthStart: {
          userId,
          monthStart,
        },
      },
      update: {
        uploadedSeconds: { increment: durationSec },
        clipCount: { increment: clipCount },
      },
      create: {
        userId,
        monthStart,
        uploadedSeconds: durationSec,
        clipCount,
      },
    });
  }
}

export function formatTranscriptTime(
  seconds: number,
  separator: ',' | '.',
): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;

  const pad = (num: number, size: number) => String(num).padStart(size, '0');
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(sec, 2)}${separator}${pad(ms, 3)}`;
}

export function formatTranscriptFile(
  segments: Array<{
    startSec: number;
    endSec: number;
    text: string;
    speaker?: string | null;
  }>,
  format: 'srt' | 'vtt' | 'txt',
): { content: string; contentType: string } {
  const BOM = '\ufeff';

  if (format === 'txt') {
    const textLines = segments.map((s) => {
      const line = s.text.trim();
      return s.speaker ? `[${s.speaker}] ${line}` : line;
    });
    return {
      content: `${BOM}${textLines.join('\n')}\n`,
      contentType: 'text/plain; charset=utf-8',
    };
  }

  const separator = format === 'srt' ? ',' : '.';
  const blocks = segments.map((s, index) => {
    const timeRange = `${formatTranscriptTime(s.startSec, separator)} --> ${formatTranscriptTime(s.endSec, separator)}`;
    let body = s.text.trim();
    if (s.speaker) {
      body =
        format === 'vtt'
          ? `<v ${s.speaker}>${body}`
          : `[${s.speaker}]: ${body}`;
    }

    return format === 'srt'
      ? `${index + 1}\n${timeRange}\n${body}`
      : `${timeRange}\n${body}`;
  });

  const header = format === 'vtt' ? 'WEBVTT\n\n' : '';
  const contentType =
    format === 'srt'
      ? 'application/x-subrip; charset=utf-8'
      : 'text/vtt; charset=utf-8';

  return {
    content: `${BOM}${header}${blocks.join('\n\n')}\n`,
    contentType,
  };
}
