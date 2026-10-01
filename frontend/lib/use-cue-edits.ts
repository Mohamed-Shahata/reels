'use client';

import { useCallback, useState } from 'react';
import type { Clip, SubtitleEdit } from './api';
import {
  editsForClip,
  setClipEdits,
  type CueEditsByClipId,
} from './subtitle-edits';

export function useCueEdits() {
  const [store, setStore] = useState<CueEditsByClipId>({});

  const editsFor = useCallback(
    (clip: Clip): SubtitleEdit[] => editsForClip(store, clip),
    [store],
  );

  const setEdits = useCallback((clip: Clip, edits: SubtitleEdit[]) => {
    setStore((current) => setClipEdits(current, clip, edits));
  }, []);

  /** Edits belong to one cue layout, so they are dropped when it changes. */
  const clear = useCallback(() => setStore({}), []);

  return { editsFor, setEdits, clear };
}
