import type { Clip, SubtitleCue, SubtitleEdit } from './api';

export const MAX_SUBTITLE_EDIT_TEXT_LENGTH = 200;

export interface ClipCueEdits {
  startSec: number;
  endSec: number;
  edits: SubtitleEdit[];
}

export type CueEditsByClipId = Record<string, ClipCueEdits>;

export type CueDrafts = Record<number, string>;

const CONTROL_CHARACTERS = /\p{Cc}/gu;

export function normalizeCueText(text: string): string {
  return text.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim();
}

export function sameEdits(
  first: readonly SubtitleEdit[],
  second: readonly SubtitleEdit[],
): boolean {
  if (first.length !== second.length) return false;

  const byIndex = new Map(
    second.map((edit) => [edit.index, normalizeCueText(edit.text)]),
  );
  return first.every(
    (edit) => byIndex.get(edit.index) === normalizeCueText(edit.text),
  );
}

export function editsToDrafts(edits: readonly SubtitleEdit[]): CueDrafts {
  return Object.fromEntries(edits.map((edit) => [edit.index, edit.text]));
}

export function draftText(cue: SubtitleCue, drafts: CueDrafts): string {
  return drafts[cue.index] ?? cue.text;
}

export function draftsToEdits(
  cues: readonly SubtitleCue[],
  drafts: CueDrafts,
): SubtitleEdit[] {
  const edits: SubtitleEdit[] = [];
  for (const cue of cues) {
    const draft = drafts[cue.index];
    if (draft === undefined) continue;

    const text = normalizeCueText(draft);
    if (text !== normalizeCueText(cue.text)) {
      edits.push({ index: cue.index, text });
    }
  }
  return edits;
}

export function editsForClip(
  store: CueEditsByClipId,
  clip: Pick<Clip, 'id' | 'startSec' | 'endSec'>,
): SubtitleEdit[] {
  const entry = store[clip.id];
  if (!entry) return [];
  return entry.startSec === clip.startSec && entry.endSec === clip.endSec
    ? entry.edits
    : [];
}

export function setClipEdits(
  store: CueEditsByClipId,
  clip: Pick<Clip, 'id' | 'startSec' | 'endSec'>,
  edits: SubtitleEdit[],
): CueEditsByClipId {
  const next = { ...store };
  if (edits.length === 0) {
    delete next[clip.id];
  } else {
    next[clip.id] = { startSec: clip.startSec, endSec: clip.endSec, edits };
  }
  return next;
}

export function countHiddenCues(edits: readonly SubtitleEdit[]): number {
  return edits.filter((edit) => edit.text === '').length;
}

export function formatCueTime(seconds: number): string {
  const totalTenths = Math.round(seconds * 10);
  const minutes = Math.floor(totalTenths / 600);
  const rest = (totalTenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}
