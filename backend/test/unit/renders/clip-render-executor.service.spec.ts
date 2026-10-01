import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../../src/config/env.schema';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import {
  ClipRenderExecutorService,
  estimateWaitProgress,
  RenderStoppedError,
} from '../../../src/renders/clip-render-executor.service';
import type { StorageService } from '../../../src/storage/storage.service';
import { getSubtitlePreset } from '../../../src/subtitles/subtitle-style';

const renderRow = {
  id: 'render-1',
  startSec: 10,
  endSec: 30,
  clip: { video: { cloudinaryId: 'cloud/video-1' } },
};

function createExecutor(row: unknown = renderRow, timeoutMs = 1000) {
  const clipRender = {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const storage = {
    startClipReelRender: jest.fn().mockResolvedValue('https://reel.example'),
  };
  const values: Record<string, unknown> = {
    RENDER_POLL_INTERVAL_MS: 1,
    RENDER_TIMEOUT_MS: timeoutMs,
  };
  const executor = new ClipRenderExecutorService(
    { clipRender } as unknown as PrismaService,
    storage as unknown as StorageService,
    { get: (key: string) => values[key] } as unknown as ConfigService<
      Env,
      true
    >,
  );
  return { executor, clipRender, storage };
}

function mockHead(...statuses: number[]) {
  const fetchSpy = jest.spyOn(globalThis, 'fetch');
  for (const status of statuses) {
    fetchSpy.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
    } as Response);
  }
  return fetchSpy;
}

describe('estimateWaitProgress', () => {
  it('eases from 30 towards 95 and never reaches 100', () => {
    expect(estimateWaitProgress(0, 60)).toBe(30);
    const samples = [2000, 5000, 10000, 20000, 60000, 600000].map((ms) =>
      estimateWaitProgress(ms, 60),
    );
    expect([...samples].sort((a, b) => a - b)).toEqual(samples);
    expect(samples[0]).toBeGreaterThan(30);
    expect(Math.max(...samples)).toBeLessThanOrEqual(95);
  });

  it('moves slower for longer clips', () => {
    expect(estimateWaitProgress(10000, 10)).toBeGreaterThan(
      estimateWaitProgress(10000, 300),
    );
  });
});

describe('ClipRenderExecutorService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts the reel render, waits through 423 responses and stores the output URL', async () => {
    const { executor, clipRender, storage } = createExecutor();
    const fetchSpy = mockHead(423, 404, 200);
    const progress = jest.fn().mockResolvedValue(undefined);

    await expect(executor.execute('render-1', progress)).resolves.toBe(
      'https://reel.example',
    );

    expect(storage.startClipReelRender).toHaveBeenCalledWith(
      'cloud/video-1',
      10,
      30,
      undefined,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy).toHaveBeenCalledWith('https://reel.example', {
      method: 'HEAD',
    });
    expect(progress.mock.calls).toEqual([[10], [30]]);
    expect(clipRender.update).toHaveBeenCalledWith({
      where: { id: 'render-1' },
      data: { outputUrl: 'https://reel.example' },
    });
  });

  it('passes the stored subtitles to the render so they are burned in', async () => {
    const style = getSubtitlePreset('REEL').style;
    const cues = [{ index: 1, startSec: 1, endSec: 2, text: 'Hello' }];
    const { executor, storage } = createExecutor({
      ...renderRow,
      subtitleStyle: style,
      subtitleCues: cues,
    });
    mockHead(200);

    await executor.execute('render-1', jest.fn().mockResolvedValue(undefined));

    expect(storage.startClipReelRender).toHaveBeenCalledWith(
      'cloud/video-1',
      10,
      30,
      { style, cues },
    );
  });

  it('renders without subtitles when none were requested', async () => {
    const { executor, storage } = createExecutor({
      ...renderRow,
      subtitleStyle: null,
      subtitleCues: null,
    });
    mockHead(200);

    await executor.execute('render-1', jest.fn().mockResolvedValue(undefined));

    expect(storage.startClipReelRender).toHaveBeenCalledWith(
      'cloud/video-1',
      10,
      30,
      undefined,
    );
  });

  it('fails before rendering when the stored subtitle data is unreadable', async () => {
    const { executor, storage } = createExecutor({
      ...renderRow,
      subtitleStyle: getSubtitlePreset('REEL').style,
      subtitleCues: 'broken',
    });

    await expect(
      executor.execute('render-1', jest.fn().mockResolvedValue(undefined)),
    ).rejects.toThrow('Stored subtitle data for the render is invalid');
    expect(storage.startClipReelRender).not.toHaveBeenCalled();
  });

  it('fails without storing an output when Cloudinary rejects the transformation', async () => {
    const { executor, clipRender } = createExecutor();
    mockHead(400);

    await expect(
      executor.execute('render-1', jest.fn().mockResolvedValue(undefined)),
    ).rejects.toThrow('Cloudinary could not render the clip (status 400)');
    expect(clipRender.update).not.toHaveBeenCalled();
  });

  it('fails when the derived clip is still not ready at the timeout', async () => {
    const { executor, clipRender } = createExecutor(renderRow, 5);
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 423 } as Response);

    await expect(
      executor.execute('render-1', jest.fn().mockResolvedValue(undefined)),
    ).rejects.toThrow('Timed out waiting for the reel to render');
    expect(clipRender.update).not.toHaveBeenCalled();
  });

  it('fails when the render or its source video no longer exists', async () => {
    const missing = createExecutor(null);
    const noAsset = createExecutor({
      ...renderRow,
      clip: { video: { cloudinaryId: null } },
    });
    const progress = jest.fn().mockResolvedValue(undefined);

    await expect(
      missing.executor.execute('render-1', progress),
    ).rejects.toThrow('Render source video is unavailable');
    await expect(
      noAsset.executor.execute('render-1', progress),
    ).rejects.toThrow('Render source video is unavailable');
    expect(missing.storage.startClipReelRender).not.toHaveBeenCalled();
    expect(noAsset.storage.startClipReelRender).not.toHaveBeenCalled();
  });

  it('stops waiting as soon as the render is stopped and stores no output', async () => {
    const { executor, clipRender } = createExecutor();
    const fetchSpy = mockHead(423, 423, 423);
    const shouldStop = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    await expect(
      executor.execute(
        'render-1',
        jest.fn().mockResolvedValue(undefined),
        shouldStop,
      ),
    ).rejects.toBeInstanceOf(RenderStoppedError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(clipRender.update).not.toHaveBeenCalled();
  });

  it('does not start the Cloudinary render when it was stopped before', async () => {
    const { executor, storage } = createExecutor();

    await expect(
      executor.execute('render-1', jest.fn().mockResolvedValue(undefined), () =>
        Promise.resolve(true),
      ),
    ).rejects.toBeInstanceOf(RenderStoppedError);

    expect(storage.startClipReelRender).not.toHaveBeenCalled();
  });
});
