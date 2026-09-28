import { Injectable, NotFoundException } from '@nestjs/common';
import type { VideoStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const createdVideoSelect = {
  id: true,
  title: true,
  status: true,
  createdAt: true,
} as const;

export interface CreatedVideo {
  id: string;
  title: string;
  status: VideoStatus;
  createdAt: Date;
}

@Injectable()
export class VideosService {
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
      publicId: `videos/${userId}/${video.id}`,
    });

    return { video, upload };
  }

  async resumeUpload(userId: string, videoId: string) {
    const video = await this.prisma.video.findFirst({
      where: { id: videoId, userId, status: 'UPLOADING' },
      select: { id: true },
    });

    if (!video) {
      throw new NotFoundException('Upload was not found');
    }

    return this.storage.createUploadSignature({
      publicId: `videos/${userId}/${video.id}`,
    });
  }
}
