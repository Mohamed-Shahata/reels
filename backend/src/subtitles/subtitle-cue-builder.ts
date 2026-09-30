export interface SubtitleWord {
  text: string;
  /** Absolute position in the source video, in seconds. */
  startSec: number;
  endSec: number;
  /** True when the timing was spread over a segment instead of measured. */
  estimated: boolean;
}

export interface SubtitleCue {
  /** 1-based position of the cue in the clip. */
  index: number;
  /** Seconds from the start of the clip, not from the start of the video. */
  startSec: number;
  endSec: number;
  text: string;
}

export interface SubtitleCueOptions {
  maxCharsPerCue: number;
  maxWordsPerCue: number;
  maxCueDurationSec: number;
  /** A silence longer than this always starts a new cue. */
  maxGapSec: number;
  /** Very short cues are held on screen up to this long when there is room. */
  minCueDurationSec: number;
}

// Sized for a 9:16 frame: short lines that stay readable on a phone.
export const DEFAULT_SUBTITLE_CUE_OPTIONS: SubtitleCueOptions = {
  maxCharsPerCue: 36,
  maxWordsPerCue: 7,
  maxCueDurationSec: 4,
  maxGapSec: 0.8,
  minCueDurationSec: 0.4,
};

// A sentence end only splits a cue once it holds this many characters, so
// "Yes." does not flash on screen for a fraction of a second.
const MIN_CHARS_FOR_SENTENCE_BREAK = 12;
// A comma-like pause splits a cue once it is this full.
const CLAUSE_BREAK_FILL_RATIO = 0.6;

const SENTENCE_END = /[.!?؟…。۔]["'”’)\]]*$/u;
const CLAUSE_END = /[,;:،؛]["'”’)\]]*$/u;

interface ClipWord {
  text: string;
  startSec: number;
  endSec: number;
}

interface DraftCue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Builds subtitle cues for one clip from word timestamps of the whole video.
 *
 * A word belongs to the clip when its midpoint lies inside the clip range, so a
 * word cut in half by a clip edge is not shown as a fragment. All times in the
 * result are relative to the clip start and stay inside `[0, clip duration]`.
 * Cues never overlap and always appear in order.
 */
export function buildSubtitleCues(
  words: readonly SubtitleWord[],
  clipStartSec: number,
  clipEndSec: number,
  options: Partial<SubtitleCueOptions> = {},
): SubtitleCue[] {
  const settings = { ...DEFAULT_SUBTITLE_CUE_OPTIONS, ...options };
  const clipDurationSec = clipEndSec - clipStartSec;
  if (!Number.isFinite(clipDurationSec) || clipDurationSec <= 0) {
    return [];
  }

  const clipWords = selectClipWords(
    words,
    clipStartSec,
    clipEndSec,
    clipDurationSec,
  );
  const drafts = groupIntoDrafts(clipWords, settings);
  const separated = separateCues(drafts);
  const held = extendShortCues(separated, settings, clipDurationSec);

  return held.map((cue, position) => ({
    index: position + 1,
    startSec: roundToMillis(cue.startSec),
    endSec: roundToMillis(cue.endSec),
    text: cue.text,
  }));
}

/**
 * Spreads a segment's text over its time range when the transcript has no word
 * timestamps (transcripts created before word timing was stored). Each word
 * gets a share of the range proportional to its length, so the result is only
 * an approximation of the audio and is marked `estimated`.
 */
export function estimateWordTimings(segment: {
  startSec: number;
  endSec: number;
  text: string;
}): SubtitleWord[] {
  const tokens = segment.text.split(/\s+/u).filter((token) => token.length > 0);
  const spanSec = segment.endSec - segment.startSec;
  if (tokens.length === 0 || !Number.isFinite(spanSec) || spanSec <= 0) {
    return [];
  }

  // The extra 1 gives every word a minimum weight, even one-letter words.
  const totalWeight = tokens.reduce((sum, token) => sum + token.length + 1, 0);
  let cursorSec = segment.startSec;

  return tokens.map((token, position) => {
    const isLast = position === tokens.length - 1;
    const endSec = isLast
      ? segment.endSec
      : cursorSec + (spanSec * (token.length + 1)) / totalWeight;
    const word: SubtitleWord = {
      text: token,
      startSec: cursorSec,
      endSec,
      estimated: true,
    };
    cursorSec = endSec;
    return word;
  });
}

function selectClipWords(
  words: readonly SubtitleWord[],
  clipStartSec: number,
  clipEndSec: number,
  clipDurationSec: number,
): ClipWord[] {
  return words
    .map((word) => ({
      text: word.text.trim(),
      startSec: word.startSec,
      endSec: Math.max(word.endSec, word.startSec),
    }))
    .filter(
      (word) =>
        word.text.length > 0 &&
        Number.isFinite(word.startSec) &&
        Number.isFinite(word.endSec),
    )
    .filter((word) => {
      const midpoint = (word.startSec + word.endSec) / 2;
      return midpoint >= clipStartSec && midpoint <= clipEndSec;
    })
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
    .map((word) => ({
      text: word.text,
      startSec: clamp(word.startSec - clipStartSec, 0, clipDurationSec),
      endSec: clamp(word.endSec - clipStartSec, 0, clipDurationSec),
    }));
}

function groupIntoDrafts(
  words: readonly ClipWord[],
  settings: SubtitleCueOptions,
): DraftCue[] {
  const drafts: DraftCue[] = [];
  let current: ClipWord[] = [];

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    drafts.push({
      startSec: current[0].startSec,
      endSec: current[current.length - 1].endSec,
      text: current.map((word) => word.text).join(' '),
    });
    current = [];
  };

  for (const word of words) {
    if (current.length > 0 && shouldBreakBefore(current, word, settings)) {
      flush();
    }
    current.push(word);
  }
  flush();

  return drafts;
}

function shouldBreakBefore(
  current: readonly ClipWord[],
  next: ClipWord,
  settings: SubtitleCueOptions,
): boolean {
  const first = current[0];
  const last = current[current.length - 1];
  const currentLength = current.reduce(
    (sum, word, position) => sum + word.text.length + (position > 0 ? 1 : 0),
    0,
  );

  if (next.startSec - last.endSec > settings.maxGapSec) {
    return true;
  }
  if (current.length >= settings.maxWordsPerCue) {
    return true;
  }
  if (currentLength + 1 + next.text.length > settings.maxCharsPerCue) {
    return true;
  }
  if (next.endSec - first.startSec > settings.maxCueDurationSec) {
    return true;
  }
  if (
    SENTENCE_END.test(last.text) &&
    currentLength >= MIN_CHARS_FOR_SENTENCE_BREAK
  ) {
    return true;
  }
  return (
    CLAUSE_END.test(last.text) &&
    currentLength >= settings.maxCharsPerCue * CLAUSE_BREAK_FILL_RATIO
  );
}

// Word timings from Whisper can overlap by a few milliseconds. The earlier cue
// gives way so the moment a word is first spoken stays accurate. If two cues
// start at the same instant the earlier one would vanish, so they are merged.
function separateCues(drafts: readonly DraftCue[]): DraftCue[] {
  const result: DraftCue[] = [];

  for (const draft of drafts) {
    const previous = result[result.length - 1];
    if (!previous) {
      result.push({ ...draft });
      continue;
    }

    if (draft.startSec <= previous.startSec) {
      previous.endSec = Math.max(previous.endSec, draft.endSec);
      previous.text = `${previous.text} ${draft.text}`;
      continue;
    }

    if (draft.startSec < previous.endSec) {
      previous.endSec = draft.startSec;
    }
    result.push({ ...draft });
  }

  return result;
}

function extendShortCues(
  cues: readonly DraftCue[],
  settings: SubtitleCueOptions,
  clipDurationSec: number,
): DraftCue[] {
  return cues.map((cue, position) => {
    if (cue.endSec - cue.startSec >= settings.minCueDurationSec) {
      return cue;
    }

    const limitSec = cues[position + 1]?.startSec ?? clipDurationSec;
    const heldEndSec = Math.min(
      cue.startSec + settings.minCueDurationSec,
      limitSec,
    );
    return { ...cue, endSec: Math.max(cue.endSec, heldEndSec) };
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function roundToMillis(value: number): number {
  return Math.round(value * 1000) / 1000;
}
