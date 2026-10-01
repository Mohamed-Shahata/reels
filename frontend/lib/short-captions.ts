import type { Transcript, TranscriptSegment } from './api';

const MAX_WORDS = 6;
const MAX_CHARS = 32;

export interface ShortCaption {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Splits one transcript sentence into short on-screen lines, the same idea as
 * the burned-in subtitles: at most a few words per line. Time is shared by
 * word length, because the preview only has the segment's start and end.
 */
export function splitSegmentCaptions(
  segment: Pick<TranscriptSegment, 'startSec' | 'endSec' | 'text'>,
): ShortCaption[] {
  const words = segment.text.split(/\s+/u).filter(Boolean);
  const span = segment.endSec - segment.startSec;
  if (words.length === 0 || !(span > 0)) return [];

  const groups: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const word of words) {
    const nextLength = length + word.length + (current.length > 0 ? 1 : 0);
    if (
      current.length > 0 &&
      (current.length >= MAX_WORDS || nextLength > MAX_CHARS)
    ) {
      groups.push(current);
      current = [];
      length = 0;
    }
    length += word.length + (current.length > 0 ? 1 : 0);
    current.push(word);
  }
  if (current.length > 0) groups.push(current);

  const weights = groups.map((group) => group.join(' ').length + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = segment.startSec;
  return groups.map((group, index) => {
    const endSec =
      index === groups.length - 1
        ? segment.endSec
        : cursor + (span * weights[index]) / total;
    const caption = { text: group.join(' '), startSec: cursor, endSec };
    cursor = endSec;
    return caption;
  });
}

/** The short line to show at `timeSec`, or null between sentences. */
export function activeShortCaption(
  transcript: Transcript | null,
  timeSec: number,
): string | null {
  const segment = transcript?.segments.find(
    (item) => timeSec >= item.startSec && timeSec < item.endSec,
  );
  if (!segment) return null;
  return (
    splitSegmentCaptions(segment).find(
      (caption) => timeSec >= caption.startSec && timeSec < caption.endSec,
    )?.text ?? null
  );
}

/**
 * The single word to show at `timeSec` for word-by-word subtitles. Like the
 * short lines, the preview only knows the sentence's start and end, so each
 * word gets a share of the time by its length.
 */
export function activeWordCaption(
  transcript: Transcript | null,
  timeSec: number,
): string | null {
  const segment = transcript?.segments.find(
    (item) => timeSec >= item.startSec && timeSec < item.endSec,
  );
  if (!segment) return null;

  const words = segment.text.split(/\s+/u).filter(Boolean);
  const span = segment.endSec - segment.startSec;
  if (words.length === 0 || !(span > 0)) return null;

  const weights = words.map((word) => word.length + 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = segment.startSec;
  for (let index = 0; index < words.length; index += 1) {
    const endSec =
      index === words.length - 1
        ? segment.endSec
        : cursor + (span * weights[index]) / total;
    if (timeSec >= cursor && timeSec < endSec) return words[index];
    cursor = endSec;
  }
  return null;
}
