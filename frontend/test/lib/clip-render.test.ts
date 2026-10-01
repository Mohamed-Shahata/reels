import type { Clip, ClipRender, SubtitleStyle } from '@/lib/api';
import {
  getClipRenderState,
  mergeRendersByClip,
  pickRender,
  readyPercent,
  renderReference,
  renderMatchesVariant,
  summarizeRenders,
  withoutSubtitledRenders,
  type RenderVariant,
} from '@/lib/clip-render';

const reelStyle: SubtitleStyle = {
  fontFamily: 'Cairo',
  fontSizePx: 34,
  bold: true,
  textColor: '#ffffff',
  backgroundColor: '#000000',
  backgroundOpacity: 0.63,
  position: 'BOTTOM',
  displayMode: 'PHRASE',
};
const plain: RenderVariant = { subtitles: false };
const withReel: RenderVariant = { subtitles: true, style: reelStyle };

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip-1',
    videoId: 'video-1',
    title: 'Takeaway',
    startSec: 10,
    endSec: 30,
    source: 'MANUAL',
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

function render(overrides: Partial<ClipRender> = {}): ClipRender {
  return {
    id: 'render-1',
    clipId: 'clip-1',
    status: 'PENDING',
    progress: 0,
    attempts: 0,
    error: null,
    startSec: 10,
    endSec: 30,
    outputUrl: null,
    subtitles: false,
    subtitleStyle: null,
    createdAt: '2026-09-29T10:00:00.000Z',
    updatedAt: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

function subtitled(overrides: Partial<ClipRender> = {}): ClipRender {
  return render({ subtitles: true, subtitleStyle: reelStyle, ...overrides });
}

describe('getClipRenderState', () => {
  it('is idle when the clip has never been rendered', () => {
    expect(getClipRenderState(clip(), undefined)).toEqual({ kind: 'idle' });
  });

  it('reports a queued render', () => {
    expect(getClipRenderState(clip(), render())).toEqual({
      kind: 'active',
      progress: 0,
      queued: true,
    });
  });

  it('reports the progress of a running render', () => {
    expect(
      getClipRenderState(clip(), render({ status: 'RUNNING', progress: 30 })),
    ).toEqual({ kind: 'active', progress: 30, queued: false });
  });

  it('reports a completed render as ready', () => {
    expect(
      getClipRenderState(
        clip(),
        render({ status: 'COMPLETED', progress: 100, outputUrl: 'https://x' }),
      ),
    ).toEqual({ kind: 'ready' });
  });

  it('exposes the failure message and render id for a retry', () => {
    expect(
      getClipRenderState(
        clip(),
        render({ status: 'FAILED', error: 'Timed out' }),
      ),
    ).toEqual({ kind: 'failed', renderId: 'render-1', message: 'Timed out' });
  });

  it.each(['COMPLETED', 'FAILED', 'RUNNING'] as const)(
    'ignores a %s render made for a range the clip no longer has',
    (status) => {
      expect(
        getClipRenderState(clip({ endSec: 45 }), render({ status })),
      ).toEqual({ kind: 'idle' });
    },
  );
});

describe('renderMatchesVariant', () => {
  it('matches a render without subtitles only to the plain variant', () => {
    expect(renderMatchesVariant(render(), plain)).toBe(true);
    expect(renderMatchesVariant(render(), withReel)).toBe(false);
  });

  it('matches a subtitled render only to the same style', () => {
    expect(renderMatchesVariant(subtitled(), withReel)).toBe(true);
    expect(renderMatchesVariant(subtitled(), plain)).toBe(false);
    expect(
      renderMatchesVariant(subtitled(), {
        subtitles: true,
        style: { ...reelStyle, position: 'TOP' },
      }),
    ).toBe(false);
  });

  it('compares colors without regard to letter case', () => {
    expect(
      renderMatchesVariant(subtitled(), {
        subtitles: true,
        style: { ...reelStyle, textColor: '#FFFFFF' },
      }),
    ).toBe(true);
  });
});

describe('pickRender', () => {
  it('returns nothing without renders', () => {
    expect(pickRender(undefined, plain)).toBeUndefined();
    expect(pickRender([], withReel)).toBeUndefined();
  });

  it('keeps the with and without subtitles renders of one clip apart', () => {
    const renders = [
      render({ id: 'plain' }),
      subtitled({ id: 'subtitled', createdAt: '2026-09-29T11:00:00.000Z' }),
    ];

    expect(pickRender(renders, plain)?.id).toBe('plain');
    expect(pickRender(renders, withReel)?.id).toBe('subtitled');
  });

  it('picks the newest render of the requested variant', () => {
    const renders = [
      render({ id: 'new', createdAt: '2026-09-29T11:00:00.000Z' }),
      render({ id: 'old', createdAt: '2026-09-29T09:00:00.000Z' }),
    ];

    expect(pickRender(renders, plain)?.id).toBe('new');
  });
});

describe('summarizeRenders', () => {
  const always = (variant: RenderVariant) => () => variant;

  it('counts each clip once by its current render state', () => {
    const clips = [
      clip({ id: 'a' }),
      clip({ id: 'b' }),
      clip({ id: 'c' }),
      clip({ id: 'd' }),
      clip({ id: 'e', endSec: 99 }),
    ];
    const rendersByClipId = {
      a: [render({ id: 'r-a', clipId: 'a', status: 'COMPLETED' })],
      b: [render({ id: 'r-b', clipId: 'b', status: 'RUNNING' })],
      c: [render({ id: 'r-c', clipId: 'c', status: 'FAILED' })],
      e: [render({ id: 'r-e', clipId: 'e', status: 'COMPLETED' })],
    };

    expect(summarizeRenders(clips, rendersByClipId, always(plain))).toEqual({
      total: 5,
      ready: 1,
      active: 1,
      failed: 1,
      pending: 2,
    });
  });

  it('counts a clip as not rendered when only the other variant exists', () => {
    const clips = [clip({ id: 'a' }), clip({ id: 'b' })];
    const rendersByClipId = {
      a: [render({ id: 'r-a', clipId: 'a', status: 'COMPLETED' })],
      b: [subtitled({ id: 'r-b', clipId: 'b', status: 'COMPLETED' })],
    };

    expect(summarizeRenders(clips, rendersByClipId, always(withReel))).toEqual({
      total: 2,
      ready: 1,
      active: 0,
      failed: 0,
      pending: 1,
    });
  });

  it('follows the variant chosen for each clip', () => {
    const clips = [clip({ id: 'a' }), clip({ id: 'b' })];
    const rendersByClipId = {
      a: [render({ id: 'r-a', clipId: 'a', status: 'COMPLETED' })],
      b: [subtitled({ id: 'r-b', clipId: 'b', status: 'COMPLETED' })],
    };

    expect(
      summarizeRenders(clips, rendersByClipId, (candidate) =>
        candidate.id === 'a' ? plain : withReel,
      ),
    ).toMatchObject({ ready: 2, pending: 0 });
  });

  it('returns zeros for a video without clips', () => {
    expect(summarizeRenders([], {}, always(plain))).toEqual({
      total: 0,
      ready: 0,
      active: 0,
      failed: 0,
      pending: 0,
    });
  });
});

describe('mergeRendersByClip', () => {
  it('groups renders by clip', () => {
    const merged = mergeRendersByClip({}, [
      render({ id: 'one' }),
      render({ id: 'two', clipId: 'clip-2' }),
    ]);

    expect(merged['clip-1']?.map((item) => item.id)).toEqual(['one']);
    expect(merged['clip-2']?.map((item) => item.id)).toEqual(['two']);
  });

  it('keeps renders of other variants and replaces one with the same id', () => {
    const first = mergeRendersByClip({}, [
      render({ id: 'plain' }),
      subtitled({ id: 'subtitled' }),
    ]);

    const updated = mergeRendersByClip(first, [
      render({ id: 'plain', status: 'COMPLETED' }),
    ]);

    expect(updated['clip-1']).toHaveLength(2);
    expect(updated['clip-1']?.find((item) => item.id === 'plain')?.status).toBe(
      'COMPLETED',
    );
  });

  it('does not change the input', () => {
    const current = { 'clip-1': [render({ id: 'one' })] };

    mergeRendersByClip(current, [render({ id: 'two' })]);

    expect(current['clip-1']).toHaveLength(1);
  });
});

describe('edited subtitle text', () => {
  const edited: RenderVariant = {
    subtitles: true,
    style: reelStyle,
    edits: [{ index: 2, text: 'Fixed line' }],
  };

  it('matches a subtitled render that has the same edits', () => {
    expect(
      renderMatchesVariant(
        subtitled({ subtitleEdits: [{ index: 2, text: 'Fixed line' }] }),
        edited,
      ),
    ).toBe(true);
  });

  it('does not match a render without edits once the text was edited', () => {
    expect(renderMatchesVariant(subtitled(), edited)).toBe(false);
  });

  it('does not match a render with other edits', () => {
    expect(
      renderMatchesVariant(
        subtitled({ subtitleEdits: [{ index: 2, text: 'Other' }] }),
        edited,
      ),
    ).toBe(false);
  });

  it('does not match an edited render when the text is not edited', () => {
    expect(
      renderMatchesVariant(
        subtitled({ subtitleEdits: [{ index: 2, text: 'Fixed line' }] }),
        withReel,
      ),
    ).toBe(false);
  });

  it('picks the render that carries the current edits', () => {
    const unedited = subtitled({
      id: 'plain',
      createdAt: '2026-09-29T11:00:00.000Z',
    });
    const withEdits = subtitled({
      id: 'edited',
      createdAt: '2026-09-29T10:00:00.000Z',
      subtitleEdits: [{ index: 2, text: 'Fixed line' }],
    });

    expect(pickRender([unedited, withEdits], edited)?.id).toBe('edited');
    expect(pickRender([unedited, withEdits], withReel)?.id).toBe('plain');
  });
});

describe('readyPercent and renderReference', () => {
  it('rounds the share of ready clips and handles an empty list', () => {
    const base = { total: 3, ready: 1, active: 0, failed: 0, pending: 2 };
    expect(readyPercent(base)).toBe(33);
    expect(readyPercent({ ...base, total: 0, ready: 0 })).toBe(0);
  });

  it('uses the last 8 characters of the render id as a reference', () => {
    expect(renderReference('cmabc12345678')).toBe('12345678');
    expect(renderReference('abcdefgh')).toBe('ABCDEFGH');
  });
});

describe('withoutSubtitledRenders', () => {
  const make = (id: string, subtitles: boolean, status: ClipRender['status']) =>
    ({ id, subtitles, status }) as ClipRender;

  const current = {
    a: [
      make('a-plain', false, 'COMPLETED'),
      make('a-done', true, 'COMPLETED'),
      make('a-failed', true, 'FAILED'),
      make('a-running', true, 'RUNNING'),
    ],
    b: [make('b-done', true, 'COMPLETED')],
  };

  it('drops finished and failed subtitled renders but keeps the rest', () => {
    const next = withoutSubtitledRenders(current);
    expect(next.a.map((r) => r.id)).toEqual(['a-plain', 'a-running']);
    expect(next.b).toEqual([]);
  });

  it('only touches the given clip', () => {
    const next = withoutSubtitledRenders(current, 'b');
    expect(next.a).toBe(current.a);
    expect(next.b).toEqual([]);
  });
});

describe('stopped renders', () => {
  it('tells a stopped render apart from a failed one', () => {
    const stopped = render({ status: 'FAILED', error: 'Stopped by the user' });
    const failed = render({ status: 'FAILED', error: 'Cloudinary error' });

    expect(getClipRenderState(clip(), stopped)).toEqual({
      kind: 'stopped',
      renderId: 'render-1',
    });
    expect(getClipRenderState(clip(), failed)).toMatchObject({
      kind: 'failed',
    });
  });

  it('counts stopped clips as still to render', () => {
    const summary = summarizeRenders(
      [clip()],
      {
        'clip-1': [render({ status: 'FAILED', error: 'Stopped by the user' })],
      },
      () => plain,
    );

    expect(summary).toMatchObject({ pending: 1, failed: 0, stopped: 1 });
  });
});
