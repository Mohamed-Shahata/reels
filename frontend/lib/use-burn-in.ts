'use client';

import { useCallback, useState } from 'react';
import {
  loadStoredBurnIn,
  setClipBurnIn,
  setGlobalBurnIn,
  storeBurnIn,
  type BurnInSettings,
} from './burn-in';

export function useBurnIn() {
  const [settings, setSettings] = useState<BurnInSettings>(() =>
    setGlobalBurnIn(loadStoredBurnIn()),
  );

  const setGlobal = useCallback((enabled: boolean) => {
    setSettings(setGlobalBurnIn(enabled));
    storeBurnIn(enabled);
  }, []);

  const setForClip = useCallback((clipId: string, enabled: boolean) => {
    setSettings((current) => setClipBurnIn(current, clipId, enabled));
  }, []);

  return { settings, setGlobal, setForClip };
}
