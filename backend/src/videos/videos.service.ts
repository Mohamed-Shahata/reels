import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { VideoStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  StorageService,
  UploadAssetNotReadyError,
} from '../storage/storage.service';
import { ProcessingJobsService } from '../processing/processing-jobs.service';

const createdVideoSelect = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
} as const;

const readyVideoSelect = {
  id: true,
  title: true,
  cloudinaryId: true,
  durationSec: true,
  sizeBytes: true,
  status: true,
} as const;

const libraryVideoSelect = {
  id: true,
  title: true,
  cloudinaryId: true,
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
    where: { type: 'TRANSCRIPTION' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { status: true, progress: true, lastError: true },
  },
} as const;

export type TranscriptionState =
  'NONE' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

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
  cloudinaryId: string;
  durationSec: number;
  sizeBytes: string;
  status: 'READY';
}

export interface LibraryVideo {
  id: string;
  title: string;
  cloudinaryId: string | null;
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
    private readonly storage: StorageService,
    private readonly jobsService: ProcessingJobsService,
  ) {}

  async createUpload(
    userId: string,
    title: string,
    options: { language?: string; autoClips?: boolean } = {},
  ): Promise<{
    video: CreatedVideo;
    upload: ReturnType<StorageService['createUploadSignature']>;
  }> {
    const video = await this.prisma.video.create({
      data: {
        userId,
        title,
        ...(options.language ? { language: options.language } : {}),
        ...(options.autoClips !== undefined
          ? { autoClips: options.autoClips }
          : {}),
      },
      select: createdVideoSelect,
    });

    const upload = this.storage.createUploadSignature({
      publicId: this.storage.getVideoPublicId(userId, video.id),
    });

    return { video, upload };
  }

  getUploadConstraints() {
    return this.storage.getUploadConstraints();
  }

  async list(userId: string): Promise<LibraryVideo[]> {
    const videos = await this.prisma.video.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: libraryVideoSelect,
    });

    return videos.map((video) => this.serializeLibraryVideo(video));
  }

  async listLibrary(userId: string): Promise<LibraryVideoSummary[]> {
    const videos = await this.prisma.video.findMany({
      where: { userId },
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
          base.status === 'READY' && base.cloudinaryId
            ? this.storage.getVideoThumbnailUrl(base.cloudinaryId)
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
      where: { id: videoId, userId, status: 'READY' },
      select: { cloudinaryId: true },
    });

    if (!video?.cloudinaryId) {
      throw new NotFoundException('Video was not found');
    }

    return this.storage.getVideoPlaybackUrl(video.cloudinaryId);
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
        lastError: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        failedAt: true,
      },
    });
  }

  async startTranscription(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: 'READY' },
      select: { id: true, language: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found or is not ready');
    }

    return this.jobsService.createJob({
      userId,
      videoId,
      type: 'TRANSCRIPTION',
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
          },
        },
      },
    });

    return transcript;
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
      where: { id: videoId, userId },
      select: { id: true, cloudinaryId: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    if (video.cloudinaryId) {
      await this.storage.deleteVideo(video.cloudinaryId);
    }

    await this.prisma.video.delete({ where: { id: video.id } });
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

    return this.storage.createUploadSignature({
      publicId: this.storage.getVideoPublicId(userId, video.id),
    });
  }

  async completeUpload(
    userId: string,
    videoId: string,
    uploadedPublicId?: string,
  ): Promise<CompletedVideo> {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: 'UPLOADING' },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Upload was not found');
    }

    const publicId = this.storage.getVideoPublicId(userId, video.id);

    try {
      const expectedSuffix = `/uploads/${userId}/${video.id}`;
      const candidates = [
        ...(uploadedPublicId?.endsWith(expectedSuffix)
          ? [uploadedPublicId]
          : []),
        publicId,
        ...this.storage.getLegacyVideoPublicIds(userId, video.id),
      ];
      const metadata = await this.storage.getVideoMetadata([
        ...new Set(candidates),
      ]);
      const completed = await this.prisma.video.update({
        where: { id: video.id },
        data: {
          cloudinaryId: metadata.publicId,
          durationSec: metadata.durationSec,
          sizeBytes: metadata.bytes,
          status: 'READY',
        },
        select: readyVideoSelect,
      });

      await this.recordUsage(userId, metadata.durationSec, 0);

      // Automatically queue transcription
      try {
        await this.startTranscription(userId, video.id);
      } catch (err) {
        this.logger.error(
          `Failed to auto-start transcription for ${video.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return {
        ...completed,
        cloudinaryId: completed.cloudinaryId!,
        durationSec: completed.durationSec!,
        sizeBytes: completed.sizeBytes!.toString(),
        status: 'READY',
      };
    } catch (error) {
      if (error instanceof UploadAssetNotReadyError) {
        throw new ConflictException(
          'Upload is still being processed. Please confirm again shortly.',
        );
      }

      this.logger.warn(
        `Could not verify upload ${video.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      await this.prisma.video.update({
        where: { id: video.id },
        data: { status: 'FAILED' },
      });

      throw new BadRequestException('Uploaded video could not be verified');
    }
  }

  private serializeLibraryVideo(video: {
    id: string;
    title: string;
    cloudinaryId: string | null;
    durationSec: number | null;
    sizeBytes: bigint | null;
    status: VideoStatus;
    createdAt: Date;
  }): LibraryVideo {
    return {
      ...video,
      sizeBytes: video.sizeBytes?.toString() ?? null,
    };
  }

  private async recordUsage(
    userId: string,
    uploadedSeconds: number,
    clipCount: number,
  ): Promise<void> {
    const monthStart = this.monthStart();
    await this.prisma.usageRecord.upsert({
      where: { userId_monthStart: { userId, monthStart } },
      create: { userId, monthStart, uploadedSeconds, clipCount },
      update: {
        uploadedSeconds: { increment: uploadedSeconds },
        clipCount: { increment: clipCount },
      },
    });
  }

  private monthStart(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
}
