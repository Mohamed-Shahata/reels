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
  ) {}

  async createUpload(
    userId: string,
    title: string,
  ): Promise<{
    video: CreatedVideo;
    upload: ReturnType<StorageService['createUploadSignature']>;
  }> {
    const video = await this.prisma.video.create({
      data: { userId, title },
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
}
