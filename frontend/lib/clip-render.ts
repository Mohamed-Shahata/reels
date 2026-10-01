import type { Clip, ClipRender, SubtitleEdit, SubtitleStyle } from './api';
import { sameEdits } from './subtitle-edits';

export type RenderVariant =
  | { subtitles: false }
  | { subtitles: true; style: SubtitleStyle; edits?: SubtitleEdit[] };

export type RendersByClipId = Record<string, ClipRender[]>;

/** The error the server stores when the user stops a render. */
export const RENDER_STOPPED_MESSAGE = 'Stopped by the user';

export type ClipRenderState =
  | { kind: 'idle' }
  | { kind: 'active'; progress: number; queued: boolean }
  | { kind: 'ready' }
  | { kind: 'stopped'; renderId: string }
  | { kind: 'failed'; renderId: string; message: string | null };

export function isRenderActive(render: ClipRender): boolean {
  return render.status === 'PENDING' || render.status === 'RUNNING';
}

export function isRenderCurrent(clip: Clip, render: ClipRender): boolean {
  return render.startSec === clip.startSec && render.endSec === clip.endSec;
}

export function getClipRenderState(
  clip: Clip,
  render: ClipRender | undefined,
): ClipRenderState {
  if (!render || !isRenderCurrent(clip, render)) {
    return { kind: 'idle' };
  }

  if (render.status === 'FAILED' && render.error === RENDER_STOPPED_MESSAGE) {
    return { kind: 'stopped', renderId: render.id };
  }

  if (render.status === 'FAILED') {
    return { kind: 'failed', renderId: render.id, message: render.error };
  }

  if (render.status === 'COMPLETED') {
    return { kind: 'ready' };
  }

  return {
    kind: 'active',
    progress: render.progress,
    queued: render.status === 'PENDING',
  };
}

export interface RenderSummary {
  total: number;
  ready: number;
  active: number;
  failed: number;
  pending: number;
  /** Renders the user stopped; they are also counted in `pending`. */
  stopped?: number;
}

export function sameStyle(
  first: SubtitleStyle,
  second: SubtitleStyle,
): boolean {
  return (
    first.fontFamily === second.fontFamily &&
    first.fontSizePx === second.fontSizePx &&
    first.bold === second.bold &&
    first.textColor.toLowerCase() === second.textColor.toLowerCase() &&
    first.backgroundColor.toLowerCase() ===
      second.backgroundColor.toLowerCase() &&
    first.backgroundOpacity === second.backgroundOpacity &&
    first.position === second.position &&
    first.displayMode === second.displayMode
  );
}

export function renderMatchesVariant(
  render: ClipRender,
  variant: RenderVariant,
): boolean {
  if (!variant.subtitles) return !render.subtitles;
  return (
    render.subtitles &&
    render.subtitleStyle !== null &&
    sameStyle(render.subtitleStyle, variant.style) &&
    sameEdits(render.subtitleEdits ?? [], variant.edits ?? [])
  );
}

export function pickRender(
  renders: ClipRender[] | undefined,
  variant: RenderVariant,
): ClipRender | undefined {
  let newest: ClipRender | undefined;
  for (const render of renders ?? []) {
    if (!renderMatchesVariant(render, variant)) continue;
    if (!newest || newest.createdAt <= render.createdAt) newest = render;
  }
  return newest;
}

export function summarizeRenders(
  clips: Clip[],
  rendersByClipId: RendersByClipId,
  variantFor: (clip: Clip) => RenderVariant,
): RenderSummary {
  const summary: RenderSummary = {
    total: clips.length,
    ready: 0,
    active: 0,
    failed: 0,
    pending: 0,
  };

  for (const clip of clips) {
    const state = getClipRenderState(
      clip,
      pickRender(rendersByClipId[clip.id], variantFor(clip)),
    );
    if (state.kind === 'ready') summary.ready += 1;
    else if (state.kind === 'active') summary.active += 1;
    else if (state.kind === 'failed') summary.failed += 1;
    else if (state.kind === 'stopped') {
      summary.pending += 1;
      summary.stopped = (summary.stopped ?? 0) + 1;
    } else summary.pending += 1;
  }

  return summary;
}

export function mergeRendersByClip(
  current: RendersByClipId,
  incoming: ClipRender[],
): RendersByClipId {
  const merged: RendersByClipId = { ...current };
  for (const render of incoming) {
    const existing = merged[render.clipId] ?? [];
    merged[render.clipId] = [
      ...existing.filter((candidate) => candidate.id !== render.id),
      render,
    ];
  }
  return merged;
}

export function readyPercent(summary: RenderSummary): number {
  if (summary.total === 0) return 0;
  return Math.round((summary.ready / summary.total) * 100);
}

export function renderReference(renderId: string): string {
  return renderId.slice(-8).toUpperCase();
}

/**
 * Drops the finished and failed renders that have burned-in subtitles, the
 * same ones the server deletes when the subtitle style or text changes.
 * Renders still in progress stay, and so do renders without subtitles.
 * `clipId` limits it to one clip.
 */
export function withoutSubtitledRenders(
  current: RendersByClipId,
  clipId?: string,
): RendersByClipId {
  const next: RendersByClipId = {};
  for (const [id, renders] of Object.entries(current)) {
    next[id] =
      clipId !== undefined && id !== clipId
        ? renders
        : renders.filter(
            (render) => !render.subtitles || isRenderActive(render),
          );
  }
  return next;
}
