'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  getApiErrorMessage,
  type SubtitleStyle,
  type SubtitleStyleCatalog,
} from './api';
import {
  changeStyle,
  loadStoredSelection,
  selectPreset,
  storeSelection,
  type SubtitleSelection,
} from './subtitle-style';

export function useSubtitleStyle(enabled: boolean) {
  const [catalog, setCatalog] = useState<SubtitleStyleCatalog | null>(null);
  const [selection, setSelection] = useState<SubtitleSelection | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    api
      .getSubtitleStyleCatalog()
      .then((nextCatalog) => {
        if (cancelled) return;
        setCatalog(nextCatalog);
        setSelection(loadStoredSelection(nextCatalog));
        setError(null);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(
            getApiErrorMessage(
              requestError,
              'Subtitle styles could not be loaded.',
            ),
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const update = useCallback((next: SubtitleSelection) => {
    setSelection(next);
    storeSelection(next);
  }, []);

  const choosePreset = useCallback(
    (presetId: string) => {
      if (catalog) update(selectPreset(catalog, presetId));
    },
    [catalog, update],
  );

  const patchStyle = useCallback(
    (patch: Partial<SubtitleStyle>) => {
      if (selection) update(changeStyle(selection, patch));
    },
    [selection, update],
  );

  const resetToPreset = useCallback(() => {
    if (catalog && selection) {
      update(selectPreset(catalog, selection.presetId));
    }
  }, [catalog, selection, update]);

  /** Puts back an earlier selection, e.g. to undo edits in the dialog. */
  const restore = useCallback(
    (previous: SubtitleSelection) => update(previous),
    [update],
  );

  return {
    catalog,
    selection,
    error,
    choosePreset,
    patchStyle,
    resetToPreset,
    restore,
  };
}
