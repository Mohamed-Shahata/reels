import { MaintenanceService } from '../../../src/jobs/maintenance/maintenance.service';

describe('MaintenanceService', () => {
  let service: MaintenanceService;
  let mockPrisma: any;
  let mockS3: any;
  let mockJobsService: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn((cb) => cb(mockPrisma)),
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ pg_try_advisory_xact_lock: true }]),
      video: {
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      mediaAsset: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      clipRender: {
        updateMany: jest.fn(),
      },
    };

    mockS3 = {
      findActiveMultipartUpload: jest.fn(),
      abortMultipart: jest.fn(),
      deleteObjects: jest.fn(),
      list: jest.fn(),
    };

    mockJobsService = {
      enqueue: jest.fn(),
    };

    service = new MaintenanceService(mockPrisma, mockS3, mockJobsService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  describe('purgeFailedUploads', () => {
    it('aborts active multipart upload on S3 and deletes stale video record', async () => {
      mockPrisma.video.findMany.mockResolvedValue([
        {
          id: 'v-stale-1',
          userId: 'u1',
          mediaAssets: [{ storageKey: 'users/u1/videos/v-stale-1/source.mp4' }],
        },
      ]);
      mockS3.findActiveMultipartUpload.mockResolvedValue('up-stale-123');
      mockS3.abortMultipart.mockResolvedValue(undefined);
      mockPrisma.video.delete.mockResolvedValue({ id: 'v-stale-1' });

      const count = await service.purgeFailedUploads();

      expect(count).toBe(1);
      expect(mockPrisma.video.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'UPLOADING',
          }),
        }),
      );
      expect(mockS3.findActiveMultipartUpload).toHaveBeenCalledWith(
        'users/u1/videos/v-stale-1/source.mp4',
      );
      expect(mockS3.abortMultipart).toHaveBeenCalledWith(
        'users/u1/videos/v-stale-1/source.mp4',
        'up-stale-123',
      );
      expect(mockPrisma.video.delete).toHaveBeenCalledWith({
        where: { id: 'v-stale-1' },
      });
    });

    it('returns 0 if no stale uploads found', async () => {
      mockPrisma.video.findMany.mockResolvedValue([]);
      const count = await service.purgeFailedUploads();
      expect(count).toBe(0);
      expect(mockS3.abortMultipart).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpiredRenders', () => {
    it('deletes expired render files from S3 and marks them DELETED in DB', async () => {
      mockPrisma.mediaAsset.findMany.mockResolvedValue([
        {
          id: 'render-asset-1',
          storageKey: 'users/u1/v1/clips/c1/renders/r1.mp4',
        },
      ]);
      mockS3.deleteObjects.mockResolvedValue(undefined);
      mockPrisma.mediaAsset.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.clipRender.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.purgeExpiredRenders();

      expect(count).toBe(1);
      expect(mockS3.deleteObjects).toHaveBeenCalledWith([
        'users/u1/v1/clips/c1/renders/r1.mp4',
      ]);
      expect(mockPrisma.mediaAsset.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['render-asset-1'] } },
        data: { status: 'DELETED' },
      });
      expect(mockPrisma.clipRender.updateMany).toHaveBeenCalledWith({
        where: { assetId: { in: ['render-asset-1'] } },
        data: { outputUrl: null },
      });
    });
  });

  describe('purgeSoftDeleted', () => {
    it('republishes CLEANUP job for videos stuck in DELETING status', async () => {
      mockPrisma.video.findMany.mockResolvedValue([
        { id: 'v-stuck-1', userId: 'u1' },
      ]);
      mockJobsService.enqueue.mockResolvedValue({ id: 'job-clean-repub' });

      const count = await service.purgeSoftDeleted();

      expect(count).toBe(1);
      expect(mockJobsService.enqueue).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          userId: 'u1',
          videoId: 'v-stuck-1',
          type: 'CLEANUP',
          maxAttempts: 10,
        }),
      );
    });
  });

  describe('orphanSweep', () => {
    it('deletes objects from S3 that do not exist in MediaAsset table', async () => {
      const yesterday = new Date(Date.now() - 25 * 3_600_000);
      mockS3.list.mockResolvedValue([
        { key: 'users/u1/v1/source.mp4', lastModified: yesterday },
        { key: 'users/u1/v1/ghost.mp4', lastModified: yesterday },
      ]);

      mockPrisma.mediaAsset.findMany.mockResolvedValue([
        { storageKey: 'users/u1/v1/source.mp4' },
      ]);

      mockS3.deleteObjects.mockResolvedValue(undefined);

      const count = await service.orphanSweep();

      expect(count).toBe(1);
      expect(mockS3.deleteObjects).toHaveBeenCalledWith([
        'users/u1/v1/ghost.mp4',
      ]);
    });
  });

  describe('advisory lock guard', () => {
    it('skips execution when advisory lock is held by another process', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { pg_try_advisory_xact_lock: false },
      ]);

      const count = await service.purgeFailedUploads();

      expect(count).toBe(0);
      expect(mockPrisma.video.findMany).not.toHaveBeenCalled();
    });
  });
});
