import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.schema';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { StorageService } from '../../../src/storage/storage.service';
import { StaleUploadCleanupService } from '../../../src/videos/stale-upload-cleanup.service';

function createService(
  prisma: { video: { findMany: jest.Mock; updateMany: jest.Mock } },
  storage: { deleteVideo: jest.Mock; getVideoPublicId: jest.Mock },
) {
  const values = {
    STALE_UPLOAD_THRESHOLD_SEC: 3600,
    STALE_UPLOAD_CLEANUP_INTERVAL_SEC: 60,
  };
  const config = { get: (key: keyof typeof values) => values[key] };

  return new StaleUploadCleanupService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    config as unknown as ConfigService<Env, true>,
  );
}

describe('StaleUploadCleanupService', () => {
  it('removes stale partial assets and marks records failed', async () => {
    const prisma = {
      video: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'video-1', userId: 'user-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const storage = {
      deleteVideo: jest.fn().mockResolvedValue(undefined),
      getVideoPublicId: jest
        .fn()
        .mockReturnValue('podcast-reels/uploads/user-1/video-1'),
    };
    const service = createService(prisma, storage);
    const now = new Date('2026-09-28T12:00:00.000Z');
    const cutoff = new Date('2026-09-28T11:00:00.000Z');

    await expect(service.cleanup(now)).resolves.toBe(1);
    expect(storage.deleteVideo).toHaveBeenCalledWith(
      'podcast-reels/uploads/user-1/video-1',
    );
    expect(prisma.video.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'video-1',
        status: 'UPLOADING',
        updatedAt: { lt: cutoff },
      },
      data: { status: 'FAILED' },
    });
  });

  it('leaves the record pending when the partial asset cannot be removed', async () => {
    const prisma = {
      video: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'video-1', userId: 'user-1' }]),
        updateMany: jest.fn(),
      },
    };
    const storage = {
      deleteVideo: jest.fn().mockRejectedValue(new Error('Cloudinary failed')),
      getVideoPublicId: jest
        .fn()
        .mockReturnValue('podcast-reels/uploads/user-1/video-1'),
    };
    const service = createService(prisma, storage);

    await expect(
      service.cleanup(new Date('2026-09-28T12:00:00.000Z')),
    ).resolves.toBe(0);
    expect(prisma.video.updateMany).not.toHaveBeenCalled();
  });
});
