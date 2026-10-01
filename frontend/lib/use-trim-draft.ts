'use client';

import { useCallback, useState } from 'react';
import type { Clip, Transcript, TranscriptSegment } from './api';
import {
  checkRange,
  formatClock,
  parseClock,
  snapToSentences,
} from './trimmer';

export interface TrimRange {
  startSec: number;
  endSec: number;
}

const DEFAULT_RANGE: TrimRange = { startSec: 0, endSec: 30 };
const SEGMENT_TITLE_MAX = 60;

/**
 * State of the clip being trimmed (range, timecode fields, title and the clip
 * it was loaded from). It lives above the workspace tabs so a clip loaded from
 * the "Clips & Export" tab or the transcript shows up in the "Trim" tab.
 */
export function useTrimDraft(transcript: Transcript | null, totalSec: number) {
  const [range, setRange] = useState<TrimRange>(DEFAULT_RANGE);
  const [startText, setStartText] = useState(formatClock(0));
  const [endText, setEndText] = useState(formatClock(DEFAULT_RANGE.endSec));
  const [title, setTitle] = useState('');
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [snapping, setSnapping] = useState(true);

  const setRangeAndText = useCallback((next: TrimRange) => {
    setRange(next);
    setStartText(formatClock(next.startSec));
    setEndText(formatClock(next.endSec));
  }, []);

  /** Applies a range, snapping it to sentence boundaries when enabled. */
  function applyRange(next: TrimRange) {
    setRangeAndText(snapping ? snapToSentences(transcript, next) : next);
  }

  function commitText(field: 'start' | 'end', value: string) {
    if (field === 'start') setStartText(value);
    else setEndText(value);
    const parsed = parseClock(value);
    if (parsed === null) return;
    setRange((current) =>
      field === 'start'
        ? { ...current, startSec: parsed }
        : { ...current, endSec: parsed },
    );
  }

  const loadClip = useCallback(
    (clip: Clip) => {
      setRangeAndText({ startSec: clip.startSec, endSec: clip.endSec });
      setTitle(clip.title);
      setActiveClipId(clip.id);
    },
    [setRangeAndText],
  );

  /** Starts a new clip from a transcript sentence (no clip is "loaded"). */
  function loadSegment(segment: TranscriptSegment) {
    const startSec = Math.floor(segment.startSec);
    const endSec = Math.ceil(segment.endSec);
    setRangeAndText({
      startSec,
      endSec: totalSec > 0 ? Math.min(totalSec, endSec) : endSec,
    });
    setTitle(segment.text.trim().slice(0, SEGMENT_TITLE_MAX));
    setActiveClipId(null);
  }

  const checks = checkRange(
    parseClock(startText),
    parseClock(endText),
    totalSec || Infinity,
  );

  return {
    range,
    startText,
    endText,
    title,
    setTitle,
    activeClipId,
    setActiveClipId,
    snapping,
    toggleSnapping: () => setSnapping((value) => !value),
    checks,
    length: Math.max(0, range.endSec - range.startSec),
    setRangeAndText,
    applyRange,
    commitText,
    loadClip,
    loadSegment,
  };
}

export type TrimDraft = ReturnType<typeof useTrimDraft>;
