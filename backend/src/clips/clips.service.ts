import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { CreateClipDto } from './dto/create-clip.dto';
import type { UpdateClipDto } from './dto/update-clip.dto';

const clipSelect = {
  id: true,
  videoId: true,
  title: true,
  startSec: true,
  endSec: true,
  createdAt: true,
  updatedAt: true,
} as const;

const clipWithVideoSelect = {
  id: true,
  startSec: true,
  endSec: true,
  video: { select: { cloudinaryId: true } },
} as const;

export interface ClipRecord {
  id: string;
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ClipsService {
  private readonly minDurationSec: number;
  private readonly maxDurationSec: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    private readonly storage: StorageService,
  ) {
    this.minDurationSec = config.get('CLIP_MIN_DURATION_SEC', {
      infer: true,
    });
    this.maxDurationSec = config.get('CLIP_MAX_DURATION_SEC', {
      infer: true,
    });
  }

  async create(
    userId: string,
    videoId: string,
    dto: CreateClipDto,
  ): Promise<ClipRecord> {
    const video = await this.getReadyVideo(userId, videoId);
    this.validateRange(dto.startSec, dto.endSec, video.durationSec);

    const created = await this.prisma.clip.create({
      data: {
        videoId: video.id,
        title: dto.title,
        startSec: dto.startSec,
        endSec: dto.endSec,
      },
      select: clipSelect,
    });
    await this.recordClipUsage(userId);
    return created;
  }

  async list(userId: string, videoId: string): Promise<ClipRecord[]> {
    await this.getOwnedVideo(userId, videoId);

    return this.prisma.clip.findMany({
      where: { videoId },
      orderBy: { startSec: 'asc' },
      select: clipSelect,
    });
  }

  async update(
    userId: string,
    clipId: string,
    dto: UpdateClipDto,
  ): Promise<ClipRecord> {
    if (
      dto.title === undefined &&
      dto.startSec === undefined &&
      dto.endSec === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one clip field to update',
      );
    }

    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: {
        id: true,
        title: true,
        startSec: true,
        endSec: true,
        video: { select: { id: true, status: true, durationSec: true } },
      },
    });

    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    this.ensureVideoReady(clip.video);
    const startSec = dto.startSec ?? clip.startSec;
    const endSec = dto.endSec ?? clip.endSec;
    this.validateRange(startSec, endSec, clip.video.durationSec);

    return this.prisma.clip.update({
      where: { id: clip.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.startSec !== undefined && { startSec: dto.startSec }),
        ...(dto.endSec !== undefined && { endSec: dto.endSec }),
      },
      select: clipSelect,
    });
  }

  async remove(userId: string, clipId: string): Promise<void> {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: { id: true },
    });

    if (!clip) {
      throw new NotFoundException('Clip was not found');
    }

    await this.prisma.clip.delete({ where: { id: clip.id } });
  }

  async getPlaybackUrl(userId: string, clipId: string): Promise<string> {
    const clip = await this.getOwnedStoredClip(userId, clipId);

    return this.storage.getClipPlaybackUrl(
      clip.video.cloudinaryId,
      clip.startSec,
      clip.endSec,
    );
  }

  async getDownloadUrl(userId: string, clipId: string): Promise<string> {
    const clip = await this.getOwnedStoredClip(userId, clipId);

    return this.storage.getClipDownloadUrl(
      clip.video.cloudinaryId,
      clip.startSec,
      clip.endSec,
      `clip-${clip.id}`,
    );
  }

  private async getOwnedVideo(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId },
      select: { id: true, status: true, durationSec: true },
    });

    if (!video) {
      throw new NotFoundException('Video was not found');
    }

    return video;
  }

  private async getReadyVideo(userId: string, videoId: string) {
    const video = await this.getOwnedVideo(userId, videoId);
    this.ensureVideoReady(video);
    return video;
  }

  private async getOwnedStoredClip(userId: string, clipId: string) {
    const clip = await this.prisma.clip.findFirst({
      where: { id: clipId, video: { is: { userId } } },
      select: clipWithVideoSelect,
    });

    const publicId = clip?.video.cloudinaryId;
    if (!clip || !publicId) {
      throw new NotFoundException('Clip was not found');
    }

    return { ...clip, video: { ...clip.video, cloudinaryId: publicId } };
  }

  private ensureVideoReady(video: {
    status: string;
    durationSec: number | null;
  }): asserts video is { status: 'READY'; durationSec: number } {
    if (video.status !== 'READY' || video.durationSec === null) {
      throw new ConflictException('Video is not ready for clipping');
    }
  }

  private validateRange(
    startSec: number,
    endSec: number,
    videoDurationSec: number,
  ): void {
    if (endSec <= startSec) {
      throw new BadRequestException('endSec must be greater than startSec');
    }

    if (endSec > videoDurationSec) {
      throw new BadRequestException(
        'endSec must not exceed the video duration',
      );
    }

    const clipDurationSec = endSec - startSec;
    if (clipDurationSec < this.minDurationSec) {
      throw new BadRequestException(
        `Clip must be at least ${this.minDurationSec} seconds long`,
      );
    }

    if (clipDurationSec > this.maxDurationSec) {
      throw new BadRequestException(
        `Clip must be at most ${this.maxDurationSec} seconds long`,
      );
    }
  }

  private async recordClipUsage(userId: string): Promise<void> {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    await this.prisma.usageRecord.upsert({
      where: { userId_monthStart: { userId, monthStart } },
      create: { userId, monthStart, uploadedSeconds: 0, clipCount: 1 },
      update: { clipCount: { increment: 1 } },
    });
  }
}
