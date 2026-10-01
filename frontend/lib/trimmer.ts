import type { Transcript } from './api';

export const MIN_CLIP_SEC = 5;
export const MAX_CLIP_SEC = 240;
export const SWEET_MIN_SEC = 15;
export const SWEET_MAX_SEC = 60;
export const TITLE_MAX = 80;
export const SNAP_TOLERANCE_SEC = 3;
export const QUICK_TRIMS = [
  { sec: 15, label: 'Stories / Shorts' },
  { sec: 30, label: 'TikTok Optimal' },
  { sec: 60, label: 'IG Reel Max' },
] as const;
// Rough H.264 1080x1920 output rate (~6.6 Mbps) used for the size estimate.
const EST_MB_PER_SEC = 0.83;

export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  return `${m.toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

/** Parses "m:ss" or "mm:ss". Returns null when malformed. */
export function parseClock(value: string): number | null {
  const match = /^(\d+):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const seconds = Number(match[2]);
  return seconds < 60 ? Number(match[1]) * 60 + seconds : null;
}

export interface RangeChecks {
  startBeforeEnd: boolean;
  withinBounds: boolean;
  durationOk: boolean;
  sweetSpot: boolean;
}

export function checkRange(
  startSec: number | null,
  endSec: number | null,
  totalSec: number,
): RangeChecks {
  const valid = startSec !== null && endSec !== null;
  const duration = valid ? endSec - startSec : 0;
  return {
    startBeforeEnd: valid && endSec > startSec,
    withinBounds: valid && startSec >= 0 && endSec <= totalSec,
    durationOk: duration >= MIN_CLIP_SEC && duration <= MAX_CLIP_SEC,
    sweetSpot: duration >= SWEET_MIN_SEC && duration <= SWEET_MAX_SEC,
  };
}

export function quickTrimEnd(
  startSec: number,
  lengthSec: number,
  totalSec: number,
): number {
  return Math.min(totalSec, startSec + lengthSec);
}

/** Clamps a dragged handle so the range stays valid and inside the episode. */
export function moveHandle(
  handle: 'start' | 'end',
  valueSec: number,
  range: { startSec: number; endSec: number },
  totalSec: number,
): { startSec: number; endSec: number } {
  if (handle === 'start') {
    const startSec = Math.min(
      Math.max(0, valueSec),
      range.endSec - MIN_CLIP_SEC,
    );
    return { startSec: Math.max(0, startSec), endSec: range.endSec };
  }
  const endSec = Math.max(
    Math.min(totalSec, valueSec),
    range.startSec + MIN_CLIP_SEC,
  );
  return { startSec: range.startSec, endSec: Math.min(totalSec, endSec) };
}

function nearest(values: number[], target: number, tolerance: number) {
  let best: number | null = null;
  for (const value of values) {
    if (Math.abs(value - target) > tolerance) continue;
    if (best === null || Math.abs(value - target) < Math.abs(best - target)) {
      best = value;
    }
  }
  return best;
}

/** Snaps boundaries to the nearest transcript sentence start/end. */
export function snapToSentences(
  transcript: Transcript | null,
  range: { startSec: number; endSec: number },
  tolerance = SNAP_TOLERANCE_SEC,
): { startSec: number; endSec: number } {
  if (!transcript?.segments.length) return range;
  const starts = transcript.segments.map((s) => s.startSec);
  const ends = transcript.segments.map((s) => s.endSec);
  const startSec = nearest(starts, range.startSec, tolerance) ?? range.startSec;
  const endSec = nearest(ends, range.endSec, tolerance) ?? range.endSec;
  return endSec - startSec >= MIN_CLIP_SEC ? { startSec, endSec } : range;
}

/** The sentence that opens / closes a range, for the snapping panel. */
export function boundarySentences(
  transcript: Transcript | null,
  range: { startSec: number; endSec: number },
) {
  const inside = (transcript?.segments ?? []).filter(
    (s) => s.endSec > range.startSec && s.startSec < range.endSec,
  );
  return {
    opening: inside[0] ?? null,
    closing: inside.length > 0 ? inside[inside.length - 1] : null,
  };
}

export function estimateFileMb(durationSec: number): number {
  return Math.round(Math.max(0, durationSec) * EST_MB_PER_SEC * 10) / 10;
}

export function activeSubtitle(
  transcript: Transcript | null,
  timeSec: number,
): string | null {
  return (
    transcript?.segments.find(
      (s) => timeSec >= s.startSec && timeSec < s.endSec,
    )?.text ?? null
  );
}

export function rulerTicks(totalSec: number, count = 8): number[] {
  if (totalSec <= 0) return [0];
  return Array.from({ length: count + 1 }, (_, i) => (totalSec * i) / count);
}
