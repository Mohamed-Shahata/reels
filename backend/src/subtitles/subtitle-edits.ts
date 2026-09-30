import { BadRequestException } from '@nestjs/common';
import type { SubtitleCue } from './subtitle-cue-builder';
import { normalizeCueText } from './subtitle-overlay';

export const MAX_SUBTITLE_EDIT_TEXT_LENGTH = 200;

export interface SubtitleEdit {
  index: number;
  text: string;
}

export interface AppliedSubtitleEdits {
  cues: SubtitleCue[];
  edits: SubtitleEdit[];
}

export interface ApplySubtitleEditsOptions {
  ignoreUnknownCues?: boolean;
}

export function applySubtitleEdits(
  cues: readonly SubtitleCue[],
  edits: readonly SubtitleEdit[],
  options: ApplySubtitleEditsOptions = {},
): AppliedSubtitleEdits {
  const cuesByIndex = new Map(cues.map((cue) => [cue.index, cue]));
  const textByIndex = new Map<number, string>();

  for (const edit of edits) {
    if (textByIndex.has(edit.index)) {
      throw new BadRequestException(
        `Subtitle cue ${edit.index} is edited more than once`,
      );
    }

    const cue = cuesByIndex.get(edit.index);
    if (!cue) {
      if (options.ignoreUnknownCues) continue;
      throw new BadRequestException(
        `Subtitle cue ${edit.index} does not exist for this clip. Reload the subtitles and try again.`,
      );
    }

    const text = normalizeCueText(edit.text);
    if (text !== normalizeCueText(cue.text)) {
      textByIndex.set(edit.index, text);
    }
  }

  const editedCues: SubtitleCue[] = [];
  for (const cue of cues) {
    const text = textByIndex.get(cue.index);
    if (text === undefined) {
      editedCues.push(cue);
    } else if (text !== '') {
      editedCues.push({ ...cue, text });
    }
  }

  const appliedEdits = [...textByIndex]
    .sort(([first], [second]) => first - second)
    .map(([index, text]) => ({ index, text }));

  return { cues: editedCues, edits: appliedEdits };
}

export function readStoredEdits(value: unknown): SubtitleEdit[] {
  if (!Array.isArray(value)) return [];

  const edits: SubtitleEdit[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { index, text } = item as Record<string, unknown>;
    if (
      typeof index === 'number' &&
      Number.isInteger(index) &&
      typeof text === 'string'
    ) {
      edits.push({ index, text });
    }
  }
  return edits;
}
