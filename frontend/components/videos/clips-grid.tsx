'use client';

import { useLanguage } from '@/lib/i18n/language-context';
import type { Clip, ClipRender } from '@/lib/api';
import { ClipCard, type ReelAspect } from './clip-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { FilmIcon, SparklesIcon, DownloadCloudIcon } from '@/components/ui/icons';
import type { ReactNode } from 'react';

interface ClipsGridProps {
  clips: Clip[];
  renders?: ClipRender[];
  activeClipId?: string | null;
  selectedClipIds?: Set<string>;
  onSelectClip?: (clipId: string) => void;
  onPreviewClip?: (clip: Clip) => void;
  onSeekClip?: (clip: Clip) => void;
  onEditClip?: (clip: Clip) => void;
  onExportClip?: (clip: Clip) => void;
  onDeleteClip?: (clip: Clip) => void;
  onRenameClip?: (clip: Clip, newTitle: string) => Promise<boolean>;
  onExportAll?: () => void;
  isExportingAll?: boolean;
  renderReel?: (
    clip: Clip,
    aspect: ReelAspect,
    onAspectChange: (a: ReelAspect) => void,
  ) => { thumbnail: ReactNode; controls: ReactNode };
}

export function ClipsGrid({
  clips,
  activeClipId,
  selectedClipIds,
  onSelectClip,
  onPreviewClip,
  onSeekClip,
  onEditClip,
  onExportClip,
  onDeleteClip,
  onRenameClip,
  onExportAll,
  isExportingAll = false,
  renderReel,
}: ClipsGridProps) {
  const { t } = useLanguage();

  if (clips.length === 0) {
    return (
      <EmptyState
        icon={<FilmIcon className="w-8 h-8" />}
        title={t('workspace.noClipsTitle')}
        description={t('workspace.noClipsDescription')}
        className="py-12 border border-dashed border-border rounded-xl"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Top action bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <SparklesIcon className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {t('workspace.clipsTab', { count: clips.length })}
          </span>
        </div>
        {onExportAll && (
          <Button
            size="sm"
            onClick={onExportAll}
            disabled={isExportingAll || clips.length === 0}
            className="flex items-center gap-1.5"
          >
            <DownloadCloudIcon className="w-4 h-4" />
            <span>
              {isExportingAll
                ? t('workspace.exportingAll')
                : t('workspace.exportAll')}
            </span>
          </Button>
        )}
      </div>

      {/* Grid of clips */}
      <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {clips.map((clip, index) => {
          const isSelected = selectedClipIds?.has(clip.id) ?? false;
          const isActive = activeClipId === clip.id;
          const rawScore = (clip as { score?: number }).score;
          const score = typeof rawScore === 'number' ? Math.round(rawScore * 100) : 85;

          return (
            <ClipCard
              key={clip.id}
              clip={clip}
              score={score}
              hook={clip.source === 'AI'}
              number={index + 1}
              active={isActive}
              selected={isSelected}
              busy={false}
              onToggleSelect={() => onSelectClip?.(clip.id)}
              onPreview={() => onPreviewClip?.(clip)}
              onSeek={() => onSeekClip?.(clip)}
              onTrim={() => onEditClip?.(clip)}
              onDownload={() => onExportClip?.(clip)}
              onDelete={() => onDeleteClip?.(clip)}
              onRename={(title) =>
                onRenameClip ? onRenameClip(clip, title) : Promise.resolve(true)
              }
              renderReel={
                renderReel
                  ? (aspect, onAspectChange) =>
                      renderReel(clip, aspect, onAspectChange)
                  : undefined
              }
            />
          );
        })}
      </ul>
    </div>
  );
}
