'use client';

import { useState, type ReactNode } from 'react';
import type { Clip } from '@/lib/api';
import { formatClipLength, scoreTier } from '@/lib/clip-insights';
import { formatClock } from '@/lib/trimmer';
import {
  ScissorsIcon,
  DownloadIcon,
  TrashIcon,
  EditIcon,
} from '@/components/ui/icons';

export type ReelAspect = '9:16' | '16:9';

export interface ClipCardProps {
  clip: Clip;
  score: number;
  hook: boolean;
  number?: number;
  active: boolean;
  selected: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onSeek: () => void;
  onTrim: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onRename: (title: string) => Promise<boolean>;
  renderReel?: (
    aspect: ReelAspect,
    onAspectChange: (a: ReelAspect) => void,
  ) => {
    thumbnail: ReactNode;
    controls: ReactNode;
  };
}

function badgeClass(clip: Clip, score: number): string {
  if (clip.source !== 'AI') return 'bg-muted text-muted-foreground border-border';
  const tier = scoreTier(score);
  if (tier === 'Viral') return 'bg-primary/15 text-primary border-primary/30';
  if (tier === 'Strong') return 'bg-secondary text-secondary-foreground border-border';
  return 'bg-muted text-muted-foreground border-border';
}

function IconButton({
  label,
  onClick,
  disabled,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'border-border bg-card text-destructive hover:border-destructive/50 hover:bg-destructive/10'
          : 'border-border bg-card text-muted-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary'
      }`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function ClipCard({
  clip,
  score,
  hook,
  number,
  active,
  selected,
  busy,
  onToggleSelect,
  onPreview,
  onSeek,
  onTrim,
  onDownload,
  onDelete,
  onRename,
  renderReel,
}: ClipCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(clip.title);
  const [saving, setSaving] = useState(false);
  const [aspect, setAspect] = useState<ReelAspect>('9:16');

  const reel = renderReel?.(aspect, setAspect);
  const isPortrait = aspect === '9:16' && reel != null;

  function startEditing() {
    setDraft(clip.title);
    setEditing(true);
  }

  async function commit() {
    const next = draft.trim();
    if (!next || next === clip.title) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const saved = await onRename(next);
    setSaving(false);
    if (saved) setEditing(false);
  }

  const topSection = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <input
            aria-label={`Select ${clip.title} for merge`}
            checked={selected}
            className="mt-1 h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
            disabled={busy}
            onChange={onToggleSelect}
            type="checkbox"
          />
          <div className="min-w-0 flex-1">
            {number ? (
              <span
                aria-label={`Clip number ${number}`}
                className="me-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground"
                title={`Clip ${number} in the episode`}
              >
                {number}
              </span>
            ) : null}
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold border ${badgeClass(clip, score)}`}
              title="Estimated from duration, speech density and opening hook"
            >
              {clip.source === 'AI'
                ? `${hook ? 'AI Hook' : 'AI Clip'} ${score}%`
                : 'Manual Segment'}
            </span>
            {editing ? (
              <input
                aria-label={`Rename ${clip.title}`}
                autoFocus
                className="mt-1 block h-8 w-full rounded-md border border-primary bg-background px-2 text-sm font-bold text-foreground ring-1 ring-primary/50"
                dir="auto"
                disabled={saving}
                maxLength={255}
                onBlur={() => void commit()}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                value={draft}
              />
            ) : (
              <button
                className="mt-1.5 block w-full min-w-0 text-start text-[15px] font-bold leading-snug text-foreground hover:text-primary transition-colors"
                dir="auto"
                onClick={onPreview}
                type="button"
              >
                {clip.title}
              </button>
            )}
          </div>
        </div>
        <IconButton
          disabled={busy || editing}
          label="Edit"
          onClick={startEditing}
        >
          <EditIcon className="w-3.5 h-3.5" />
        </IconButton>
      </div>

      <div className="mt-1 flex items-center justify-between text-xs">
        <button
          className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-primary hover:border-primary/40 hover:bg-muted transition-colors"
          onClick={onSeek}
          type="button"
        >
          {formatClock(clip.startSec)} - {formatClock(clip.endSec)}
        </button>
        <span className="text-muted-foreground">
          {formatClipLength(clip.startSec, clip.endSec)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <IconButton disabled={busy} label="Trim" onClick={onTrim}>
          <ScissorsIcon className="w-3.5 h-3.5" />
        </IconButton>
        <IconButton disabled={busy} label="Download" onClick={onDownload}>
          <DownloadIcon className="w-3.5 h-3.5" />
        </IconButton>
        <IconButton danger disabled={busy} label="Delete" onClick={onDelete}>
          <TrashIcon className="w-3.5 h-3.5" />
        </IconButton>
      </div>
    </>
  );

  return (
    <li
      className={`rounded-2xl border p-3.5 transition-all duration-200 ${
        active
          ? 'border-primary bg-card ring-2 ring-primary/25 shadow-sm'
          : 'border-border bg-card hover:border-border/80 shadow-sm'
      }`}
    >
      {isPortrait ? (
        <div className="flex gap-3">
          <div className="w-[7.5rem] shrink-0 self-start sm:w-36">
            <div className="aspect-[9/16] w-full overflow-hidden rounded-xl">
              {reel.thumbnail}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
            <div>{topSection}</div>
            <div className="border-t border-border pt-2">{reel.controls}</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {topSection}
          {reel != null && (
            <>
              <div className="my-1 flex w-full justify-center overflow-hidden rounded-xl">
                <div className="w-full max-w-md">{reel.thumbnail}</div>
              </div>
              <div className="border-t border-border pt-2">{reel.controls}</div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
