import { ConflictException } from '@nestjs/common';
import { VideosService } from '../../../src/videos/videos.service';
import { RendersService } from '../../../src/renders/renders.service';
import { createPrismaFake } from '../../support/prisma-fake';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { S3StorageService } from '../../../src/storage/s3-storage.service';
import type { MediaAssetService } from '../../../src/storage/media-asset.service';
import type { ProcessingJobsService } from '../../../src/processing/processing-jobs.service';

describe('Resource Limits & Quotas (Task 7.4)', () => {
  const userId = 'usr-limits-1';
  let prisma: ReturnType<typeof createPrismaFake>;
  let videosService: VideosService;
  let rendersService: RendersService;

  beforeEach(() => {
    prisma = createPrismaFake();

    const mockS3 = {
      createMultipartUpload: jest.fn().mockResolvedValue({ uploadId: 'u-1' }),
      createMultipart: jest.fn().mockResolvedValue({ uploadId: 'u-1' }),
      getUploadPartUrl: jest.fn().mockResolvedValue('https://s3.local/part'),
      presignPart: jest.fn().mockResolvedValue('https://s3.local/part'),
      checkHealth: jest.fn().mockResolvedValue(true),
    };

    const mockMediaAsset = {
      register: jest.fn().mockResolvedValue({ id: 'a-1', storageKey: 'k-1' }),
      markReady: jest.fn().mockResolvedValue({ id: 'a-1', status: 'READY' }),
    };

    const mockJobsService = {
      enqueueJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };

    const mockSubtitles = {
      getClipSubtitles: jest.fn(),
      buildCues: jest.fn(),
      wordsForSegment: jest.fn(),
      describeTiming: jest.fn(),
    };

    videosService = new VideosService(
      prisma as unknown as PrismaService,
      mockJobsService as unknown as ProcessingJobsService,
      mockS3 as unknown as S3StorageService,
      mockMediaAsset as unknown as MediaAssetService,
    );

    rendersService = new RendersService(
      prisma as unknown as PrismaService,
      mockJobsService as unknown as ProcessingJobsService,
      mockSubtitles as unknown as any,
      mockMediaAsset as unknown as MediaAssetService,
    );
  });

  describe('Concurrent Videos Limit', () => {
    it('allows creating videos up to the concurrent limit', async () => {
      // Create 2 uploading videos
      await prisma.video.create({
        data: { userId, title: 'Video 1', status: 'UPLOADING' },
      });
      await prisma.video.create({
        data: { userId, title: 'Video 2', status: 'UPLOADING' },
      });

      // 3rd video should succeed
      const res = await videosService.createUpload(userId, 'Video 3', {
        filename: 'v3.mp4',
        sizeBytes: 100_000,
      });
      expect(res.video.title).toBe('Video 3');
    });

    it('throws ConflictException when user reaches MAX_CONCURRENT_VIDEOS limit of 3', async () => {
      // Pre-fill 3 active videos
      await prisma.video.create({
        data: { userId, title: 'Active 1', status: 'UPLOADING' },
      });
      await prisma.video.create({
        data: { userId, title: 'Active 2', status: 'UPLOADING' },
      });
      await prisma.video.create({
        data: { userId, title: 'Active 3', status: 'UPLOADING' },
      });

      await expect(
        videosService.createUpload(userId, 'Active 4', {
          filename: 'v4.mp4',
          sizeBytes: 100_000,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Storage Quota Limit', () => {
    it('throws ConflictException when incoming video exceeds user storage quota (10GB)', async () => {
      // Pre-fill 10 GB of existing media assets
      await prisma.mediaAsset.upsert({
        where: { storageKey: 'asset-large-1' },
        create: {
          userId,
          kind: 'SOURCE',
          storageKey: 'asset-large-1',
          sizeBytes: 10_500_000_000n, // 10.5 GB
          status: 'READY',
        },
        update: {},
      });

      // Request upload of 1 GB (total = 11.5 GB > 10 GiB limit)
      await expect(
        videosService.createUpload(userId, 'Too Big Video', {
          filename: 'large.mp4',
          sizeBytes: 1_000_000_000, // 1 GB
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('allows upload when within the 10GB storage quota', async () => {
      await prisma.mediaAsset.upsert({
        where: { storageKey: 'asset-small-1' },
        create: {
          userId,
          kind: 'SOURCE',
          storageKey: 'asset-small-1',
          sizeBytes: 1_000_000_000n, // 1 GB
          status: 'READY',
        },
        update: {},
      });

      // Request upload of 500 MB (total = 1.5 GB <= 10 GB)
      const res = await videosService.createUpload(userId, 'Acceptable Video', {
        filename: 'ok.mp4',
        sizeBytes: 500_000_000,
      });
      expect(res.video.title).toBe('Acceptable Video');
    });
  });

  describe('Concurrent Renders Limit', () => {
    it('throws ConflictException when user reaches MAX_CONCURRENT_RENDERS limit of 2', async () => {
      const vid = await prisma.video.create({
        data: { userId, title: 'Vid for Renders', status: 'READY' },
      });
      const clip = await prisma.clip.create({
        data: { videoId: vid.id, title: 'Clip 1', startSec: 0, endSec: 15 },
        select: { id: true },
      });

      // Pre-fill 2 active renders
      await prisma.clipRender.create({
        data: { clipId: clip.id, status: 'PENDING' },
      });
      await prisma.clipRender.create({
        data: { clipId: clip.id, status: 'PROCESSING' },
      });

      await expect(
        rendersService.create(userId, clip.id, { subtitles: false }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
