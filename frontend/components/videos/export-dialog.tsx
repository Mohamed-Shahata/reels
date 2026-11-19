'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/language-context';
import type { Clip } from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FilmIcon, SparklesIcon, CheckIcon } from '@/components/ui/icons';

interface ExportDialogProps {
  clip: Clip | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmExport: (options: { resolution: '1080p' | '720p'; subtitles: boolean }) => void;
  isExporting?: boolean;
}

export function ExportDialog({
  clip,
  isOpen,
  onClose,
  onConfirmExport,
  isExporting = false,
}: ExportDialogProps) {
  const { t } = useLanguage();
  const [resolution, setResolution] = useState<'1080p' | '720p'>('1080p');
  const [burnSubtitles, setBurnSubtitles] = useState(true);

  const handleExport = () => {
    onConfirmExport({ resolution, subtitles: burnSubtitles });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilmIcon className="w-5 h-5 text-primary" />
            <span>{t('workspace.exportModalTitle')}</span>
          </DialogTitle>
          {clip && (
            <DialogDescription className="truncate">
              {clip.title}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Resolution Options */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t('workspace.quality')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setResolution('1080p')}
                className={`p-3 rounded-lg border text-start transition-all ${
                  resolution === '1080p'
                    ? 'border-primary bg-primary/10 text-primary shadow-sm'
                    : 'border-border bg-card hover:bg-muted/50 text-foreground'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">1080p</span>
                  {resolution === '1080p' && <CheckIcon className="w-4 h-4 text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground">{t('workspace.quality1080p')}</p>
              </button>

              <button
                type="button"
                onClick={() => setResolution('720p')}
                className={`p-3 rounded-lg border text-start transition-all ${
                  resolution === '720p'
                    ? 'border-primary bg-primary/10 text-primary shadow-sm'
                    : 'border-border bg-card hover:bg-muted/50 text-foreground'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">720p</span>
                  {resolution === '720p' && <CheckIcon className="w-4 h-4 text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground">{t('workspace.quality720p')}</p>
              </button>
            </div>
          </div>

          {/* Subtitles Toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
            <div className="space-y-0.5 pe-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <SparklesIcon className="w-4 h-4 text-primary" />
                <span>{t('workspace.burnSubtitles')}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('workspace.burnSubtitlesDesc')}
              </p>
            </div>
            <Switch
              checked={burnSubtitles}
              onCheckedChange={setBurnSubtitles}
              aria-label={t('workspace.burnSubtitles')}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={isExporting}>
            {t('video.cancel')}
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? t('workspace.saving') : t('workspace.startExport')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
