import {
  buildZip,
  clipFileName,
  DownloadCancelledError,
  mapPool,
  safeFileName,
  sortClipsByTimeline,
  subtitledReadiness,
  uniqueNames,
  waitForSubtitledRenders,
} from '@/lib/clip-download';

describe('clip-download', () => {
  it('sorts clips by their place in the episode', () => {
    const sorted = sortClipsByTimeline([
      { id: 'c', startSec: 90, endSec: 120 },
      { id: 'a', startSec: 0, endSec: 30 },
      { id: 'b', startSec: 30, endSec: 60 },
    ]);
    expect(sorted.map((clip) => clip.id)).toEqual(['a', 'b', 'c']);
  });

  it('cleans titles but keeps Arabic', () => {
    expect(safeFileName('هل في تون معين؟ / "مقدمة"')).toBe(
      'هل في تون معين؟ مقدمة',
    );
    expect(safeFileName('  ..  ')).toBe('clip');
  });

  it('prefixes the timeline number', () => {
    expect(clipFileName('Intro', 1, 21)).toBe('01 - Intro.mp4');
    expect(clipFileName('Last', 120, 120)).toBe('120 - Last.mp4');
  });

  it('keeps names unique', () => {
    expect(uniqueNames(['a.mp4', 'A.mp4', 'b.mp4'])).toEqual([
      'a.mp4',
      'A (2).mp4',
      'b.mp4',
    ]);
  });

  it('builds a zip with utf-8 names', () => {
    const blobPart = buildZip([
      { name: '01 - مقدمة.mp4', data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(blobPart.size).toBeGreaterThan(0);
  });

  it('limits concurrency and keeps order', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe('render readiness and waiting', () => {
  const clip = {
    id: 'c1',
    startSec: 0,
    endSec: 30,
  } as unknown as import('@/lib/api').Clip;
  const variant = {
    subtitles: true,
    style: {
      fontFamily: 'Arial',
      fontSizePx: 34,
      bold: false,
      textColor: '#fff',
      backgroundColor: '#000',
      backgroundOpacity: 0.5,
      position: 'BOTTOM',
    },
  } as unknown as import('@/lib/clip-render').RenderVariant;
  const render = (
    over: Record<string, unknown>,
  ): import('@/lib/api').ClipRender =>
    ({
      id: 'r1',
      clipId: 'c1',
      startSec: 0,
      endSec: 30,
      status: 'COMPLETED',
      outputUrl: 'https://x/y.mp4',
      subtitles: true,
      subtitleStyle: (variant as { style: unknown }).style,
      subtitleEdits: [],
      createdAt: '2026-01-01T00:00:00Z',
      ...over,
    }) as unknown as import('@/lib/api').ClipRender;

  it('tells ready, rendering and missing reels apart', () => {
    expect(subtitledReadiness(clip, [render({})], variant).kind).toBe('ready');
    expect(
      subtitledReadiness(
        clip,
        [render({ status: 'RUNNING', outputUrl: null })],
        variant,
      ).kind,
    ).toBe('rendering');
    expect(subtitledReadiness(clip, [], variant).kind).toBe('needs-render');
    expect(
      subtitledReadiness(clip, [render({ status: 'FAILED' })], variant).kind,
    ).toBe('needs-render');
    expect(
      subtitledReadiness(clip, [render({ endSec: 40 })], variant).kind,
    ).toBe('needs-render');
  });

  it('waits until renders finish and maps failures to null', async () => {
    const loads = [
      [render({ status: 'RUNNING', outputUrl: null })],
      [render({})],
    ];
    const progress: number[] = [];
    const result = await waitForSubtitledRenders({
      clips: [clip],
      variantFor: () => variant,
      load: async () => loads.shift() ?? [render({})],
      onProgress: (done) => progress.push(done),
      isCancelled: () => false,
      sleep: async () => undefined,
    });
    expect(result.get('c1')?.id).toBe('r1');
    expect(progress).toEqual([0, 1]);

    const failed = await waitForSubtitledRenders({
      clips: [clip],
      variantFor: () => variant,
      load: async () => [render({ status: 'FAILED', outputUrl: null })],
      onProgress: () => undefined,
      isCancelled: () => false,
      sleep: async () => undefined,
    });
    expect(failed.get('c1')).toBeNull();
  });

  it('stops when cancelled', async () => {
    await expect(
      waitForSubtitledRenders({
        clips: [clip],
        variantFor: () => variant,
        load: async () => [],
        onProgress: () => undefined,
        isCancelled: () => true,
      }),
    ).rejects.toBeInstanceOf(DownloadCancelledError);
  });
});
