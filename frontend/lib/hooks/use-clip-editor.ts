'use client';

import { useState, useCallback, useMemo } from 'react';
import { type Clip, api } from '@/lib/api';

export function useClipEditor() {
  const [activeClip, setActiveClip] = useState<Clip | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const [title, setTitle] = useState('');
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(0);
  const [layout, setLayout] = useState<'AUTO' | 'STACKED'>('AUTO');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState('modern_bold');

  const [isSaving, setIsSaving] = useState(false);

  const openEditor = useCallback((clip: Clip) => {
    setActiveClip(clip);
    setTitle(clip.title);
    setStartSec(clip.startSec);
    setEndSec(clip.endSec);
    setLayout(clip.layout ?? 'AUTO');
    setSubtitlesEnabled(true);
    setIsOpen(true);
  }, []);

  const closeEditor = useCallback(() => {
    setIsOpen(false);
    setActiveClip(null);
  }, []);

  const isDirty = useMemo(() => {
    if (!activeClip) return false;
    return (
      title !== activeClip.title ||
      startSec !== activeClip.startSec ||
      endSec !== activeClip.endSec ||
      layout !== (activeClip.layout ?? 'AUTO')
    );
  }, [activeClip, title, startSec, endSec, layout]);

  const save = useCallback(
    async (onSuccess?: (updated: Clip) => void) => {
      if (!activeClip) return;
      setIsSaving(true);
      try {
        const updated = await api.updateClip(activeClip.id, {
          title: title.trim() || activeClip.title,
          startSec,
          endSec,
          layout,
        });
        setActiveClip(updated);
        onSuccess?.(updated);
        return updated;
      } finally {
        setIsSaving(false);
      }
    },
    [activeClip, title, startSec, endSec, layout],
  );

  return {
    isOpen,
    activeClip,
    title,
    startSec,
    endSec,
    layout,
    subtitlesEnabled,
    subtitleStyle,
    isSaving,
    isDirty,
    openEditor,
    closeEditor,
    setTitle,
    setStartSec,
    setEndSec,
    setLayout,
    setSubtitlesEnabled,
    setSubtitleStyle,
    save,
  };
}
