'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { Clip, ReframePlan } from '@/lib/api';
import { formatClock, parseClock } from '@/lib/trimmer';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { SparklesIcon, SlidersIcon, FilmIcon, SaveIcon } from '@/components/ui/icons';

interface ClipEditorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  clip: Clip | null;
  videoPlaybackUrl?: string | null;
  reframePlan?: ReframePlan | null;
  contentType?: 'SOLO' | 'PODCAST' | null;
  onSave?: (updated: Clip) => Promise<void>;
  onExport?: (clip: Clip) => void;
}

function ClipEditorForm({
  clip,
  videoPlaybackUrl,
  contentType,
  onSave,
  onExport,
}: {
  clip: Clip;
  videoPlaybackUrl?: string | null;
  reframePlan?: ReframePlan | null;
  contentType?: 'SOLO' | 'PODCAST' | null;
  onSave?: (updated: Clip) => Promise<void>;
  onExport?: (clip: Clip) => void;
}) {
  const { t } = useLanguage();

  const [title, setTitle] = useState(clip.title);
  const [startClock, setStartClock] = useState(() => formatClock(clip.startSec));
  const [endClock, setEndClock] = useState(() => formatClock(clip.endSec));
  const [layout, setLayout] = useState<'AUTO' | 'STACKED'>(clip.layout ?? 'AUTO');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState('modern');
  const [isSaving, setIsSaving] = useState(false);

  const currentStartSec = parseClock(startClock) ?? clip.startSec;
  const currentEndSec = parseClock(endClock) ?? clip.endSec;
  const durationSec = Math.max(0, currentEndSec - currentStartSec);

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave({
        ...clip,
        title: title.trim() || clip.title,
        startSec: currentStartSec,
        endSec: currentEndSec,
        layout,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* 9:16 Video Preview container */}
        <div className="flex justify-center">
          <div className="relative aspect-[9/16] w-48 sm:w-56 overflow-hidden rounded-xl border border-border bg-black shadow-md flex items-center justify-center">
            {videoPlaybackUrl ? (
              <video
                src={videoPlaybackUrl}
                className="w-full h-full object-cover"
                controls
                playsInline
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground p-4 text-center">
                <FilmIcon className="w-8 h-8 opacity-40" />
                <span className="text-xs">9:16 Preview</span>
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {t('trimmer.clipTitle')}
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clip title"
          />
        </div>

        {/* Trim Timecodes */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Trim Range
            </label>
            <Badge variant="muted" className="text-xs">
              {Math.round(durationSec)}s
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">
                {t('trimmer.startTimecode')}
              </span>
              <Input
                value={startClock}
                onChange={(e) => setStartClock(e.target.value)}
                placeholder="00:00"
                className="font-mono text-center"
              />
            </div>
            <div>
              <span className="text-[11px] text-muted-foreground block mb-1">
                {t('trimmer.endTimecode')}
              </span>
              <Input
                value={endClock}
                onChange={(e) => setEndClock(e.target.value)}
                placeholder="00:00"
                className="font-mono text-center"
              />
            </div>
          </div>
        </div>

        {/* Podcast Layout */}
        {contentType === 'PODCAST' && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {t('workspace.layoutMode')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLayout('AUTO')}
                className={`p-2.5 rounded-lg border text-start text-xs font-medium transition-all ${
                  layout === 'AUTO'
                    ? 'border-primary bg-primary/10 text-primary shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {t('workspace.layoutAuto')}
              </button>
              <button
                type="button"
                onClick={() => setLayout('STACKED')}
                className={`p-2.5 rounded-lg border text-start text-xs font-medium transition-all ${
                  layout === 'STACKED'
                    ? 'border-primary bg-primary/10 text-primary shadow-sm'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                }`}
              >
                {t('workspace.layoutStacked')}
              </button>
            </div>
          </div>
        )}

        {/* Subtitles & Style Presets */}
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SparklesIcon className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium text-foreground">{t('workspace.subtitlesToggle')}</span>
            </div>
            <Switch checked={subtitlesEnabled} onCheckedChange={setSubtitlesEnabled} />
          </div>

          {subtitlesEnabled && (
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[
                { id: 'modern', label: t('workspace.styleModern') },
                { id: 'classic', label: t('workspace.styleClassic') },
                { id: 'karaoke', label: t('workspace.styleKaraoke') },
              ].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSubtitleStyle(preset.id)}
                  className={`p-2 rounded-lg border text-center text-xs transition-all ${
                    subtitleStyle === preset.id
                      ? 'border-primary bg-primary/10 text-primary font-semibold shadow-sm'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <DrawerFooter className="border-t border-border p-4 flex flex-row items-center justify-between gap-3">
        <Button variant="outline" onClick={handleSave} disabled={isSaving} className="flex-1">
          <SaveIcon className="w-4 h-4 me-1.5" />
          <span>{isSaving ? t('workspace.saving') : t('workspace.saveChanges')}</span>
        </Button>

        <Button onClick={() => onExport?.(clip)} className="flex-1">
          <FilmIcon className="w-4 h-4 me-1.5" />
          <span>{t('workspace.exportClip')}</span>
        </Button>
      </DrawerFooter>
    </>
  );
}

export function ClipEditorDrawer({
  isOpen,
  onClose,
  clip,
  videoPlaybackUrl,
  reframePlan,
  contentType,
  onSave,
  onExport,
}: ClipEditorDrawerProps) {
  const { t } = useLanguage();

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="end" className="flex flex-col">
        <DrawerHeader className="border-b border-border pb-3">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <SlidersIcon className="w-4 h-4 text-primary" />
            <span>{t('workspace.clipEditorTitle')}</span>
          </DrawerTitle>
        </DrawerHeader>

        {clip ? (
          <ClipEditorForm
            key={clip.id}
            clip={clip}
            videoPlaybackUrl={videoPlaybackUrl}
            reframePlan={reframePlan}
            contentType={contentType}
            onSave={onSave}
            onExport={onExport}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
