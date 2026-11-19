'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { Clip, ReframePlan, TranscriptSegment } from '@/lib/api';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerFooter,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SlidersIcon, FilmIcon, SaveIcon } from '@/components/ui/icons';
import { ClipPreviewPlayer } from './clip-preview-player';
import { ClipTrimSlider } from './clip-trim-slider';
import { ClipSubtitleEditor } from './clip-subtitle-editor';

interface ClipEditorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  clip: Clip | null;
  videoPlaybackUrl?: string | null;
  reframePlan?: ReframePlan | null;
  contentType?: 'SOLO' | 'PODCAST' | null;
  transcriptSegments?: TranscriptSegment[];
  onSave?: (updated: Clip) => Promise<void>;
  onExport?: (clip: Clip) => void;
}

function ClipEditorForm({
  clip,
  videoPlaybackUrl,
  reframePlan,
  contentType,
  transcriptSegments = [],
  onSave,
  onExport,
}: {
  clip: Clip;
  videoPlaybackUrl?: string | null;
  reframePlan?: ReframePlan | null;
  contentType?: 'SOLO' | 'PODCAST' | null;
  transcriptSegments?: TranscriptSegment[];
  onSave?: (updated: Clip) => Promise<void>;
  onExport?: (clip: Clip) => void;
}) {
  const { t } = useLanguage();

  const [title, setTitle] = useState(clip.title);
  const [startSec, setStartSec] = useState(clip.startSec);
  const [endSec, setEndSec] = useState(clip.endSec);
  const [layout, setLayout] = useState<'AUTO' | 'STACKED'>(clip.layout ?? 'AUTO');
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState('modern');
  const [currentTimeSec, setCurrentTimeSec] = useState(clip.startSec);
  const [isSaving, setIsSaving] = useState(false);

  // Active caption text during playback
  const activeCaption = transcriptSegments.find(
    (s) => currentTimeSec >= s.startSec && currentTimeSec <= s.endSec,
  )?.text;

  const handleSave = async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave({
        ...clip,
        title: title.trim() || clip.title,
        startSec,
        endSec,
        layout,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* 9:16 Real-time CSS Reframe / Crop Preview */}
        <ClipPreviewPlayer
          videoPlaybackUrl={videoPlaybackUrl}
          startSec={startSec}
          endSec={endSec}
          reframePlan={reframePlan}
          layout={layout}
          subtitlesEnabled={subtitlesEnabled}
          subtitleStyle={subtitleStyle}
          activeCaption={activeCaption}
          onTimeChange={setCurrentTimeSec}
        />

        {/* Title Input */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted uppercase tracking-wider">
            {t('trimmer.clipTitle')}
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clip title"
            aria-label="Clip title"
          />
        </div>

        {/* Trim Timeline Slider */}
        <ClipTrimSlider
          startSec={startSec}
          endSec={endSec}
          onRangeChange={(newStart, newEnd) => {
            setStartSec(newStart);
            setEndSec(newEnd);
          }}
        />

        {/* Podcast Layout Selector */}
        {contentType === 'PODCAST' && (
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">
              {t('workspace.layoutMode')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLayout('AUTO')}
                className={`p-2.5 rounded-lg border text-start text-xs font-medium transition-all ${
                  layout === 'AUTO'
                    ? 'border-accent bg-accent-soft text-accent shadow-xs'
                    : 'border-border bg-surface-2 text-muted hover:bg-surface'
                }`}
              >
                {t('workspace.layoutAuto')}
              </button>
              <button
                type="button"
                onClick={() => setLayout('STACKED')}
                className={`p-2.5 rounded-lg border text-start text-xs font-medium transition-all ${
                  layout === 'STACKED'
                    ? 'border-accent bg-accent-soft text-accent shadow-xs'
                    : 'border-border bg-surface-2 text-muted hover:bg-surface'
                }`}
              >
                {t('workspace.layoutStacked')}
              </button>
            </div>
          </div>
        )}

        {/* Subtitle Style & Cue Editor */}
        <ClipSubtitleEditor
          subtitlesEnabled={subtitlesEnabled}
          onSubtitlesToggle={setSubtitlesEnabled}
          subtitleStyle={subtitleStyle}
          onStyleChange={setSubtitleStyle}
          segments={transcriptSegments}
          startSec={startSec}
          endSec={endSec}
        />
      </div>

      <DrawerFooter className="border-t border-border p-4 flex flex-row items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1"
        >
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
  transcriptSegments,
  onSave,
  onExport,
}: ClipEditorDrawerProps) {
  const { t } = useLanguage();

  return (
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent side="end" className="flex flex-col">
        <DrawerHeader className="border-b border-border pb-3">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <SlidersIcon className="w-4 h-4 text-accent" />
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
            transcriptSegments={transcriptSegments}
            onSave={onSave}
            onExport={onExport}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
