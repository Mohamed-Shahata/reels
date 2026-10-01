'use client';

import type { Clip } from '@/lib/api';
import { formatClipLength, scoreTier } from '@/lib/clip-insights';
import { formatClock } from '@/lib/trimmer';
import { useState, type ReactNode } from 'react';

export type ReelAspect = '9:16' | '16:9';

interface ClipCardProps {
  clip: Clip;
  score: number;
  hook: boolean;
  /** 1-based place of the clip in the episode, shown as a badge. */
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
  /**
   * Render prop — receives the current aspect so the reel section can
   * stay in sync with the card layout.  Must return:
   * { thumbnail: ReactNode; controls: ReactNode }
   */
  renderReel?: (
    aspect: ReelAspect,
    onAspectChange: (a: ReelAspect) => void,
  ) => {
    thumbnail: ReactNode;
    controls: ReactNode;
  };
}

const cairo = { fontFamily: 'var(--font-cairo), sans-serif' };

function badgeClass(clip: Clip, score: number): string {
  if (clip.source !== 'AI') return 'bg-[#e5e7eb] text-[#374151]';
  const tier = scoreTier(score);
  if (tier === 'Viral') return 'bg-[#d1fae5] text-[#047857]';
  if (tier === 'Strong') return 'bg-[#dbeafe] text-[#1d4ed8]';
  return 'bg-[#e5e7eb] text-[#374151]';
}

function TrimIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" x2="8.12" y1="4" y2="15.88" />
      <line x1="14.47" x2="20" y1="9.53" y2="20" />
      <line x1="8.12" x2="12" y1="8.12" y2="12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
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
      className={`flex h-8 w-8 items-center justify-center rounded-lg border bg-white disabled:cursor-not-allowed disabled:opacity-50 ${
        danger
          ? 'border-[#ecd0ca] text-[#a13a28] hover:border-[#c44932] hover:bg-[#fff2ef]'
          : 'border-[#d5e2dc] text-[#3f4f4a] hover:border-[#0f766e] hover:bg-[#e4f3ef] hover:text-[#0f766e]'
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

  /** The top metadata + action buttons section */
  const topSection = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <input
            aria-label={`Select ${clip.title} for merge`}
            checked={selected}
            className="mt-1 h-4 w-4 cursor-pointer accent-[#0f766e] disabled:cursor-not-allowed"
            disabled={busy}
            onChange={onToggleSelect}
            type="checkbox"
          />
          <div className="min-w-0 flex-1">
            {number ? (
              <span
                aria-label={`Clip number ${number}`}
                className="mr-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0f766e] px-1.5 text-[11px] font-bold text-white"
                title={`Clip ${number} in the episode`}
              >
                {number}
              </span>
            ) : null}
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${badgeClass(clip, score)}`}
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
                className="mt-1 block h-8 w-full rounded-md border border-[#0f766e] px-2 text-sm font-bold"
                dir="auto"
                disabled={saving}
                maxLength={255}
                onBlur={() => void commit()}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commit();
                  if (e.key === 'Escape') setEditing(false);
                }}
                style={cairo}
                value={draft}
              />
            ) : (
              <button
                className="mt-1.5 block w-full min-w-0 text-start text-[15px] font-bold leading-snug hover:text-[#0f766e]"
                dir="auto"
                onClick={onPreview}
                style={cairo}
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
          <EditIcon />
        </IconButton>
      </div>

      <div className="mt-1 flex items-center justify-between text-xs">
        <button
          className="rounded-md bg-[#e4f3ef] px-1.5 py-0.5 font-mono text-[#0f766e] hover:bg-[#d3ebe5]"
          onClick={onSeek}
          type="button"
        >
          {formatClock(clip.startSec)} - {formatClock(clip.endSec)}
        </button>
        <span className="text-[#5d6d68]">
          {formatClipLength(clip.startSec, clip.endSec)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <IconButton disabled={busy} label="Trim" onClick={onTrim}>
          <TrimIcon />
        </IconButton>
        <IconButton disabled={busy} label="Download" onClick={onDownload}>
          <DownloadIcon />
        </IconButton>
        <IconButton danger disabled={busy} label="Delete" onClick={onDelete}>
          <DeleteIcon />
        </IconButton>
      </div>
    </>
  );

  return (
    <li
      className={`rounded-2xl border p-3.5 ${active ? 'border-[#0f766e] bg-[#eef8f5] shadow-[0_0_0_3px_rgba(15,118,110,0.10)]' : 'border-[#e2eae6] bg-[#fafcfb] hover:border-[#c9ddd5]'}`}
    >
      {isPortrait ? (
        /* ── 9:16 portrait layout: thumbnail left | info+controls right ── */
        <div className="flex gap-3">
          {/* Left: 9:16 thumbnail — fixed ratio, never stretches with the card */}
          <div className="w-[7.5rem] shrink-0 self-start sm:w-36">
            <div className="aspect-[9/16] w-full overflow-hidden rounded-lg">
              {reel.thumbnail}
            </div>
          </div>
          {/* Right: top info + bottom reel controls */}
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
            <div>{topSection}</div>
            <div className="border-t border-[#eef2f0] pt-2">
              {reel.controls}
            </div>
          </div>
        </div>
      ) : (
        /* ── 16:9 layout: top info, thumbnail centered in the middle, then controls below ── */
        <div className="flex flex-col gap-2.5">
          {topSection}
          {reel != null && (
            <>
              <div className="my-1 flex w-full justify-center overflow-hidden rounded-lg">
                <div className="w-full max-w-md">{reel.thumbnail}</div>
              </div>
              <div className="border-t border-[#eef2f0] pt-2">
                {reel.controls}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
