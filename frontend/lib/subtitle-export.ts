import type { Clip, SubtitleCue, SubtitleEdit } from './api';
import { normalizeCueText } from './subtitle-edits';

export type SubtitleExportFormat = 'srt' | 'vtt' | 'txt';

export const SUBTITLE_EXPORT_MIME: Record<SubtitleExportFormat, string> = {
  srt: 'application/x-subrip;charset=utf-8',
  vtt: 'text/vtt;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
};

// Lets Windows players and editors read Arabic as UTF-8.
const BYTE_ORDER_MARK = '\ufeff';

/**
 * The cues as they will be burned in: edited text replaces the transcript text
 * and a cue edited to empty text is hidden, so the exported file always matches
 * the video. Times are relative to the clip start.
 */
export function applyCueEdits(
  cues: readonly SubtitleCue[],
  edits: readonly SubtitleEdit[],
): SubtitleCue[] {
  const textByIndex = new Map(edits.map((edit) => [edit.index, edit.text]));
  const result: SubtitleCue[] = [];
  for (const cue of cues) {
    const text = normalizeCueText(textByIndex.get(cue.index) ?? cue.text);
    if (!text || cue.endSec <= cue.startSec) continue;
    result.push({ ...cue, text });
  }
  return result;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

export function formatSubtitleTime(
  seconds: number,
  separator: ',' | '.',
): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(totalSec % 60, 2)}${separator}${pad(ms, 3)}`;
}

/** Returns an empty string when no cue has visible text. */
export function buildClipSubtitleFile(
  cues: readonly SubtitleCue[],
  edits: readonly SubtitleEdit[],
  format: SubtitleExportFormat,
): string {
  const visible = applyCueEdits(cues, edits);
  if (visible.length === 0) return '';

  if (format === 'txt') {
    return `${BYTE_ORDER_MARK}${visible.map((cue) => cue.text).join('\n')}\n`;
  }

  const separator = format === 'srt' ? ',' : '.';
  const blocks = visible.map((cue, position) => {
    const range = `${formatSubtitleTime(cue.startSec, separator)} --> ${formatSubtitleTime(cue.endSec, separator)}`;
    return format === 'srt'
      ? `${position + 1}\n${range}\n${cue.text}`
      : `${range}\n${cue.text}`;
  });
  const header = format === 'vtt' ? 'WEBVTT\n\n' : '';
  return `${BYTE_ORDER_MARK}${header}${blocks.join('\n\n')}\n`;
}

export function subtitleFileName(
  clip: Pick<Clip, 'id' | 'title'>,
  format: SubtitleExportFormat,
): string {
  const base = clip.title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${base || `clip-${clip.id}`}.${format}`;
}
