import type { Clip, Transcript, TranscriptSegment } from './api';

export type ClipFilter = 'all' | 'hooks' | 'ready' | 'draft';
export type ClipTier = 'Viral' | 'Strong' | 'Good' | 'Fair';

const HOOK_PATTERN =
  /[؟?]|ازاي|إزاي|كيف|ليه|ليش|لماذا|سر|الحقيقة|غلط|اوعى|أوعى|متعمل|لازم|أهم|اهم|\b(how|why|secret|mistake|truth|never|stop)\b/i;

export function segmentsInRange(
  transcript: Transcript | null,
  startSec: number,
  endSec: number,
): TranscriptSegment[] {
  if (!transcript) return [];
  return transcript.segments.filter(
    (segment) => segment.endSec > startSec && segment.startSec < endSec,
  );
}

export function hasHook(
  transcript: Transcript | null,
  clip: Pick<Clip, 'startSec' | 'endSec'>,
): boolean {
  const first = segmentsInRange(transcript, clip.startSec, clip.endSec)[0];
  return first ? HOOK_PATTERN.test(first.text) : false;
}

/**
 * Estimated (heuristic) viral score, 40-99. It is derived from real signals:
 * duration, speech density and whether the opening line looks like a hook.
 * It is NOT an AI prediction.
 */
export function estimateViralScore(
  transcript: Transcript | null,
  clip: Pick<Clip, 'startSec' | 'endSec' | 'source'>,
): number {
  const duration = Math.max(1, clip.endSec - clip.startSec);
  let score = 55;
  if (duration >= 20 && duration <= 60) score += 20;
  else if (duration <= 90) score += 10;
  else if (duration > 120) score -= 10;

  const words = segmentsInRange(transcript, clip.startSec, clip.endSec)
    .map((segment) => segment.text.trim().split(/\s+/).length)
    .reduce((sum, count) => sum + count, 0);
  const wordsPerSec = words / duration;
  if (wordsPerSec >= 2 && wordsPerSec <= 3.6) score += 10;
  else if (wordsPerSec < 1) score -= 8;

  if (hasHook(transcript, clip)) score += 12;
  if (clip.source === 'AI') score += 3;
  return Math.min(99, Math.max(40, Math.round(score)));
}

export function scoreTier(score: number): ClipTier {
  if (score >= 90) return 'Viral';
  if (score >= 80) return 'Strong';
  if (score >= 70) return 'Good';
  return 'Fair';
}

export function filterClips<T extends { score: number; ready: boolean }>(
  items: T[],
  filter: ClipFilter,
): T[] {
  if (filter === 'hooks') return items.filter((item) => item.score > 90);
  if (filter === 'ready') return items.filter((item) => item.ready);
  if (filter === 'draft') return items.filter((item) => !item.ready);
  return items;
}

export function searchSegments(
  segments: TranscriptSegment[],
  query: string,
): TranscriptSegment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return segments;
  return segments.filter((segment) =>
    segment.text.toLowerCase().includes(needle),
  );
}

function stamp(seconds: number, separator: ',' | '.'): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (n: number, l = 2) => n.toString().padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(Math.min(ms, 999), 3)}`;
}

export function buildSubtitleFile(
  segments: TranscriptSegment[],
  format: 'srt' | 'vtt',
): string {
  const separator = format === 'srt' ? ',' : '.';
  const body = segments
    .map((segment, index) => {
      const range = `${stamp(segment.startSec, separator)} --> ${stamp(segment.endSec, separator)}`;
      const lines = [range, segment.text.trim()];
      return (format === 'srt' ? [String(index + 1), ...lines] : lines).join(
        '\n',
      );
    })
    .join('\n\n');
  return format === 'vtt' ? `WEBVTT\n\n${body}\n` : `${body}\n`;
}

export function buildTranscriptText(segments: TranscriptSegment[]): string {
  return `${segments.map((segment) => segment.text.trim()).join('\n')}\n`;
}

export function downloadTextFile(
  filename: string,
  content: string,
  mime: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function formatClipLength(startSec: number, endSec: number): string {
  const total = Math.max(0, Math.round(endSec - startSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
