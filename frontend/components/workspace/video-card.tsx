'use client';

import type { LibrarySummary } from '@/lib/api';
import { formatDuration } from '@/lib/library-filters';
import Link from 'next/link';

export type CardMode = 'view' | 'renaming' | 'confirming-delete';

interface VideoCardProps {
  video: LibrarySummary;
  mode: CardMode;
  draftTitle: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onBeginRename: () => void;
  onCancel: () => void;
  onSaveRename: () => void;
  onBeginDelete: () => void;
  onConfirmDelete: () => void;
}

const dateFormat = new Intl.DateTimeFormat('en', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function VideoCard({
  video,
  mode,
  draftTitle,
  busy,
  onDraftChange,
  onBeginRename,
  onCancel,
  onSaveRename,
  onBeginDelete,
  onConfirmDelete,
}: VideoCardProps) {
  const uploading = video.status === 'UPLOADING';
  const failed = video.status === 'FAILED';
  const ready = video.status === 'READY';

  return (
    <li className="overflow-hidden rounded-xl border border-[#dfe6e2] bg-white shadow-sm">
      <div className="relative aspect-video bg-[#123b3a]">
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className={`h-full w-full object-cover ${uploading ? 'blur-sm' : ''}`}
            src={video.thumbnailUrl}
          />
        ) : null}
        {failed ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#c44932] text-lg font-bold text-white"
            >
              !
            </span>
          </div>
        ) : null}
        {uploading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 px-4 text-center text-xs font-medium text-white">
            Waiting for the upload to finish...
          </div>
        ) : null}
        {video.reelCount > 0 ? (
          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white">
            {video.reelCount} {video.reelCount === 1 ? 'Reel' : 'Reels'}{' '}
            Generated
          </span>
        ) : null}
        {video.durationSec ? (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
            {formatDuration(video.durationSec)}
          </span>
        ) : null}
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between text-[11px]">
          <StatusPill video={video} />
          <span className="text-[#7a8883]">
            {dateFormat.format(new Date(video.createdAt))}
          </span>
        </div>

        {mode === 'renaming' ? (
          <div className="mt-3">
            <label
              className="block text-[11px] text-[#5d6d68]"
              htmlFor={`title-${video.id}`}
            >
              Editing Title (Arabic):
            </label>
            <input
              className="mt-1 h-9 w-full rounded-md border border-[#0f766e] px-2 text-sm outline-none ring-2 ring-[#0f766e]/20"
              dir="auto"
              disabled={busy}
              id={`title-${video.id}`}
              maxLength={200}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && draftTitle.trim()) onSaveRename();
                if (event.key === 'Escape') onCancel();
              }}
              value={draftTitle}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                className="h-8 rounded-md border border-[#d5dcd8] px-3 text-xs font-medium text-[#263532] disabled:opacity-50"
                disabled={busy}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-8 rounded-md bg-[#0f766e] px-3 text-xs font-semibold text-white disabled:opacity-50"
                disabled={busy || !draftTitle.trim()}
                onClick={onSaveRename}
                type="button"
              >
                {busy ? 'Saving' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <h2
            className="mt-3 line-clamp-2 min-h-[2.75rem] font-[family-name:var(--font-cairo)] text-[15px] font-bold leading-snug text-[#172321]"
            dir="auto"
          >
            {video.title}
          </h2>
        )}

        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#5d6d68]">
          {ready ? <li>{video.clipCount} clips</li> : null}
          <li>
            {video.transcriptReady
              ? 'Transcript ready'
              : video.transcriptionState === 'RUNNING' ||
                  video.transcriptionState === 'PENDING'
                ? `Generating Arabic transcript${video.transcriptionProgress > 0 ? ` (${video.transcriptionProgress}%)` : '...'}`
                : 'No transcript generated'}
          </li>
        </ul>

        {video.failureReason ? (
          <p
            className="mt-3 rounded-md bg-[#fff2ef] px-2.5 py-2 text-[11px] text-[#8f2f1f]"
            role="alert"
          >
            {video.failureReason}
          </p>
        ) : null}

        {mode === 'confirming-delete' ? (
          <div
            className="mt-3 rounded-md border border-[#f0c4bb] bg-[#fff2ef] p-2.5 text-[11px] text-[#8f2f1f]"
            role="alertdialog"
          >
            Delete this video? This cannot be undone.
            <div className="mt-2 flex justify-end gap-2">
              <button
                className="h-8 rounded-md border border-[#d5dcd8] bg-white px-3 text-xs font-medium text-[#263532] disabled:opacity-50"
                disabled={busy}
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-8 rounded-md bg-[#b42318] px-3 text-xs font-semibold text-white disabled:opacity-50"
                disabled={busy}
                onClick={onConfirmDelete}
                type="button"
              >
                {busy ? 'Deleting' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex items-center justify-between border-t border-[#eef1ef] pt-3">
            {ready ? (
              <Link
                className="text-xs font-semibold text-[#0f766e] hover:underline"
                href={`/videos/${video.id}`}
              >
                Open Editor
              </Link>
            ) : failed || uploading ? (
              <Link
                className="text-xs font-semibold text-[#c44932] hover:underline"
                href="/videos/new"
              >
                {failed ? 'Retry Upload' : 'Resume Upload'}
              </Link>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-1">
              {mode === 'view' && ready ? (
                <button
                  aria-label={`Rename ${video.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[#5d6d68] hover:bg-[#f0f3f1] disabled:opacity-50"
                  disabled={busy}
                  onClick={onBeginRename}
                  type="button"
                >
                  <PencilIcon />
                </button>
              ) : null}
              <button
                aria-label={`Delete ${video.title}`}
                className="flex h-8 w-8 items-center justify-center rounded-md text-[#5d6d68] hover:bg-[#fff2ef] hover:text-[#b42318] disabled:opacity-50"
                disabled={busy}
                onClick={onBeginDelete}
                type="button"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function StatusPill({ video }: { video: LibrarySummary }) {
  const config =
    video.status === 'FAILED'
      ? { label: 'Failed', className: 'bg-[#fff2ef] text-[#b42318]' }
      : video.status === 'UPLOADING'
        ? { label: 'Uploading', className: 'bg-[#fff6e5] text-[#a15c07]' }
        : { label: 'Ready', className: 'bg-[#e4f3ef] text-[#0f766e]' };

  return (
    <span
      className={`rounded-full px-2 py-0.5 font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}
