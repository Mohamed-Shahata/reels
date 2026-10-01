import { zipSync } from 'fflate';
import type { Clip, ClipRender } from './api';
import {
  isRenderActive,
  isRenderCurrent,
  mergeRendersByClip,
  pickRender,
  type RenderVariant,
} from './clip-render';

/** Clips in the order they appear in the episode (intro first). */
export function sortClipsByTimeline<
  T extends Pick<Clip, 'startSec' | 'endSec'>,
>(clips: readonly T[]): T[] {
  return [...clips].sort(
    (a, b) => a.startSec - b.startSec || a.endSec - b.endSec,
  );
}

/** Makes a clip title safe to use as a file name (Arabic is kept as is). */
export function safeFileName(title: string, fallback = 'clip'): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  return (cleaned || fallback).slice(0, 80).trim();
}

/** "01 - Title.mp4": the number keeps the timeline order when files sort. */
export function clipFileName(
  title: string,
  number: number,
  total: number,
): string {
  const width = Math.max(2, String(total).length);
  return `${String(number).padStart(width, '0')} - ${safeFileName(title)}.mp4`;
}

/** Makes every name in the list unique by adding " (2)", " (3)"... */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf('.');
    return `${name.slice(0, dot)} (${count})${name.slice(dot)}`;
  });
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function fetchVideoBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** MP4 is already compressed, so files are stored without deflate. */
export function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
  const entries: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const file of files) entries[file.name] = [file.data, { level: 0 }];
  const zipped = zipSync(entries);
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

/** Runs `worker` over `items` with at most `limit` in flight. */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

export type DownloadReadiness = 'ready' | 'rendering' | 'needs-render';

/** Whether a clip already has a finished reel with the requested subtitles. */
export function subtitledReadiness(
  clip: Clip,
  renders: ClipRender[] | undefined,
  variant: RenderVariant,
): { kind: DownloadReadiness; render?: ClipRender } {
  const render = pickRender(renders, variant);
  if (!render || !isRenderCurrent(clip, render))
    return { kind: 'needs-render' };
  if (render.status === 'COMPLETED' && render.outputUrl) {
    return { kind: 'ready', render };
  }
  if (isRenderActive(render)) return { kind: 'rendering', render };
  return { kind: 'needs-render' };
}

export class DownloadCancelledError extends Error {
  constructor() {
    super('Download cancelled');
  }
}

/**
 * Polls until every clip has a finished subtitled render. A clip whose render
 * failed maps to null so the caller can skip it.
 */
export async function waitForSubtitledRenders(options: {
  clips: Clip[];
  variantFor: (clip: Clip) => RenderVariant;
  load: () => Promise<ClipRender[]>;
  onProgress: (finished: number, total: number) => void;
  isCancelled: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<Map<string, ClipRender | null>> {
  const {
    clips,
    variantFor,
    load,
    onProgress,
    isCancelled,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    intervalMs = 3000,
    timeoutMs = 15 * 60_000,
  } = options;
  const startedAt = Date.now();

  for (;;) {
    if (isCancelled()) throw new DownloadCancelledError();
    const grouped = mergeRendersByClip({}, await load());
    const settled = new Map<string, ClipRender | null>();

    for (const clip of clips) {
      const render = pickRender(grouped[clip.id], variantFor(clip));
      if (!render || !isRenderCurrent(clip, render)) continue;
      if (render.status === 'COMPLETED' && render.outputUrl) {
        settled.set(clip.id, render);
      } else if (render.status === 'FAILED') {
        settled.set(clip.id, null);
      }
    }

    onProgress(settled.size, clips.length);
    if (settled.size === clips.length) return settled;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Rendering is taking too long. Please try again later.');
    }
    await sleep(intervalMs);
  }
}
