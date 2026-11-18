import { Readable, Writable } from 'node:stream';
import {
  RenderConsumer,
  type RenderPayload,
} from '../../../src/jobs/consumers/render.consumer';
import { FatalJobError } from '../../../src/jobs/errors/job.error';
import type { ProcessingJob } from '../../../src/generated/prisma/client';
import type { JobExecutionContext } from '../../../src/jobs/base/base-job-consumer';

jest.mock('node:fs', () => {
  const actualFs = jest.requireActual('node:fs');
  return {
    ...actualFs,
    createWriteStream: jest.fn().mockImplementation(() => {
      return new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
    }),
  };
});

jest.mock('node:fs/promises', () => {
  const actualFsPromises = jest.requireActual('node:fs/promises');
  return {
    ...actualFsPromises,
    readFile: jest.fn().mockResolvedValue(Buffer.from('fake-mp4-data')),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
});

describe('RenderConsumer', () => {
  let consumer: RenderConsumer;
  let mockPrisma: any;
  let mockRabbit: any;
  let mockS3: any;
  let mockMediaAssets: any;
  let mockFfmpegRender: any;
  let mockConfig: any;
  let mockCtx: JobExecutionContext;

  const mockJob: ProcessingJob = {
    id: 'job-1',
    userId: 'user-1',
    videoId: 'v1',
    type: 'RENDER',
    status: 'RUNNING',
    idempotencyKey: 'key-1',
    bullJobId: null,
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    lockedBy: 'worker-1',
    heartbeatAt: new Date(),
    errorCode: null,
    lastError: null,
    payload: { clipRenderId: 'cr-1' },
    startedAt: new Date(),
    completedAt: null,
    failedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockRender = {
    id: 'cr-1',
    clipId: 'c-1',
    startSec: 10,
    endSec: 25,
    subtitleKey: null,
    subtitleStyle: {
      fontFamily: 'Cairo',
      fontSizePx: 36,
      bold: true,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.7,
      position: 'BOTTOM',
    },
    subtitleCues: [
      { index: 1, startSec: 0, endSec: 5, text: 'مرحبا بكم في الحلقة' },
    ],
    clip: {
      id: 'c-1',
      title: 'Top Highlight',
      layout: 'AUTO',
      video: {
        id: 'v1',
        userId: 'user-1',
        contentType: 'SOLO',
        mediaAssets: [
          {
            id: 'asset-source-1',
            kind: 'SOURCE',
            storageKey: 'users/user-1/videos/v1/source.mp4',
            status: 'READY',
          },
        ],
        reframePlan: {
          id: 'rf-1',
          version: 1,
          contentType: 'SOLO',
          faces: [{ timestamp: 0, x: 0.5, y: 0.5, w: 0.3, h: 0.3 }],
          speakerTurns: null,
        },
      },
    },
  };

  beforeEach(() => {
    mockPrisma = {
      clipRender: {
        findUnique: jest.fn().mockResolvedValue(mockRender),
        update: jest.fn().mockResolvedValue({ id: 'cr-1' }),
      },
      mediaAsset: {
        findFirst: jest.fn().mockResolvedValue(null), // no cache hit by default
      },
    };

    mockRabbit = {
      consume: jest.fn(),
      publish: jest.fn(),
    };

    mockS3 = {
      getObjectStream: jest
        .fn()
        .mockResolvedValue(Readable.from(['sample-video-chunk'])),
    };

    mockMediaAssets = {
      putAsset: jest.fn().mockResolvedValue({
        id: 'asset-render-1',
        storageKey: 'users/user-1/videos/v1/clips/c-1/renders/cr-1.mp4',
      }),
      signedUrl: jest.fn().mockResolvedValue('https://signed-url/render.mp4'),
    };

    mockFfmpegRender = {
      renderClip: jest
        .fn()
        .mockResolvedValue({ outputPath: '/tmp/render-cr-1.mp4' }),
    };

    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'WORKER_CONCURRENCY_RENDER') return 1;
        if (key === 'RENDER_RETENTION_DAYS') return 14;
        if (key === 'DOWNLOAD_URL_TTL_SEC') return 300;
        return undefined;
      }),
    };

    mockCtx = {
      jobId: 'job-1',
      videoId: 'v1',
      workDir: 'D:\\temp\\test-render-workdir',
      heartbeat: jest.fn().mockResolvedValue(undefined),
      updateProgress: jest.fn().mockResolvedValue(undefined),
      logEvent: jest.fn().mockResolvedValue(undefined),
      isCancelled: jest.fn().mockResolvedValue(false),
    };

    consumer = new RenderConsumer(
      mockPrisma,
      mockRabbit,
      mockS3,
      mockMediaAssets,
      mockFfmpegRender,
      mockConfig,
    );
  });

  it('renders clip successfully on happy path with subtitles and uploads asset', async () => {
    const payload: RenderPayload = { clipRenderId: 'cr-1' };

    await (consumer as any).handle(mockJob, payload, mockCtx);

    expect(mockS3.getObjectStream).toHaveBeenCalledWith(
      'users/user-1/videos/v1/source.mp4',
    );
    expect(mockFfmpegRender.renderClip).toHaveBeenCalledWith(
      expect.objectContaining({
        startSec: 10,
        endSec: 25,
        layout: 'AUTO',
        contentType: 'SOLO',
        targetWidth: 1080,
        targetHeight: 1920,
      }),
    );
    expect(mockMediaAssets.putAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        videoId: 'v1',
        clipId: 'c-1',
        kind: 'RENDER',
        contentType: 'video/mp4',
      }),
    );
    expect(mockPrisma.clipRender.update).toHaveBeenCalledWith({
      where: { id: 'cr-1' },
      data: {
        assetId: 'asset-render-1',
        outputUrl: 'https://signed-url/render.mp4',
      },
    });
    expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);
  });

  it('reuses existing READY render asset when idempotent cache hits without re-rendering', async () => {
    mockPrisma.mediaAsset.findFirst.mockResolvedValue({
      id: 'cached-render-asset',
      status: 'READY',
    });

    const payload: RenderPayload = { clipRenderId: 'cr-1' };

    await (consumer as any).handle(mockJob, payload, mockCtx);

    expect(mockFfmpegRender.renderClip).not.toHaveBeenCalled();
    expect(mockMediaAssets.putAsset).not.toHaveBeenCalled();
    expect(mockMediaAssets.signedUrl).toHaveBeenCalledWith(
      'cached-render-asset',
      300,
    );
    expect(mockPrisma.clipRender.update).toHaveBeenCalledWith({
      where: { id: 'cr-1' },
      data: {
        assetId: 'cached-render-asset',
        outputUrl: 'https://signed-url/render.mp4',
      },
    });
    expect(mockCtx.updateProgress).toHaveBeenCalledWith(100);
  });

  it('throws FatalJobError when clipRenderId is missing', async () => {
    await expect(
      (consumer as any).handle(mockJob, {}, mockCtx),
    ).rejects.toThrow(FatalJobError);
  });

  it('throws FatalJobError when ClipRender is not found in DB', async () => {
    mockPrisma.clipRender.findUnique.mockResolvedValue(null);

    await expect(
      (consumer as any).handle(
        mockJob,
        { clipRenderId: 'nonexistent' },
        mockCtx,
      ),
    ).rejects.toThrow(FatalJobError);
  });

  it('throws FatalJobError when source media asset is not found', async () => {
    mockPrisma.clipRender.findUnique.mockResolvedValue({
      ...mockRender,
      clip: {
        ...mockRender.clip,
        video: {
          ...mockRender.clip.video,
          mediaAssets: [], // no source asset
        },
      },
    });

    await expect(
      (consumer as any).handle(mockJob, { clipRenderId: 'cr-1' }, mockCtx),
    ).rejects.toThrow(FatalJobError);
  });
});
