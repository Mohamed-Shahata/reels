import { createHash } from 'node:crypto';
import type { SubtitleCue } from './subtitle-cue-builder';

const CONTROL_CHARACTERS = /\p{Cc}/gu;

export function normalizeCueText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

// Cloudinary does not wrap or align a subtitles layer, so lines are broken
// here. Keeping them short leaves room around the text inside the frame.
export const MAX_SUBTITLE_LINE_CHARS = 20;

/**
 * Breaks a cue into balanced lines at word boundaries, so a second line never
 * holds a single leftover word when the text could be split evenly. A cue that
 * is one word, or short enough, stays on one line.
 */
export function wrapCueText(
  text: string,
  maxLineChars = MAX_SUBTITLE_LINE_CHARS,
): string[] {
  const words = text.split(' ').filter(Boolean);
  const total = words.join(' ').length;
  const lineCount = Math.min(words.length, Math.ceil(total / maxLineChars));
  if (lineCount <= 1) return [words.join(' ')];

  const width = (from: number, to: number) =>
    words.slice(from, to).join(' ').length;

  // best[k][i]: lowest sum of squared line widths for the first i words on k lines.
  const best: number[][] = Array.from({ length: lineCount + 1 }, () =>
    Array<number>(words.length + 1).fill(Infinity),
  );
  const cut: number[][] = Array.from({ length: lineCount + 1 }, () =>
    Array<number>(words.length + 1).fill(0),
  );
  best[0][0] = 0;

  for (let k = 1; k <= lineCount; k++) {
    for (let i = k; i <= words.length; i++) {
      for (let j = k - 1; j < i; j++) {
        const cost = best[k - 1][j] + width(j, i) ** 2;
        if (cost < best[k][i]) {
          best[k][i] = cost;
          cut[k][i] = j;
        }
      }
    }
  }

  const lines: string[] = [];
  let end = words.length;
  for (let k = lineCount; k >= 1; k--) {
    const start = cut[k][end];
    lines.unshift(words.slice(start, end).join(' '));
    end = start;
  }
  return lines;
}

function formatTimestamp(totalSec: number): string {
  const totalMs = Math.max(0, Math.round(totalSec * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/**
 * Builds an SRT file from the clip's cues. Cue times are relative to the clip
 * start, which is what Cloudinary expects because the layer is applied after
 * the clip is trimmed. Empty cues and cues that do not last are dropped.
 * Returns an empty string when there is nothing to show.
 */
export function buildSrt(cues: readonly SubtitleCue[]): string {
  const blocks: string[] = [];

  for (const cue of cues) {
    const text = normalizeCueText(cue.text);
    if (!text || cue.endSec <= cue.startSec) continue;
    blocks.push(
      `${blocks.length + 1}\n${formatTimestamp(cue.startSec)} --> ${formatTimestamp(cue.endSec)}\n${wrapCueText(text).join('\n')}\n`,
    );
  }

  return blocks.join('\n');
}

/** Same subtitles always give the same key, so uploads can be repeated safely. */
export function subtitleFileKey(srt: string): string {
  return createHash('sha256').update(srt).digest('hex').slice(0, 32);
}
