'use client';

import * as React from 'react';
import Link from 'next/link';
import type { LibrarySummary } from '@/lib/api';
import { formatDuration } from '@/lib/library-filters';
import { useLanguage } from '@/lib/i18n/language-context';
import { Badge, Button, Input } from '@/components/ui';

export type CardMode = 'view' | 'renaming' | 'confirming-delete';

export interface VideoCardProps {
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
  const { t, language } = useLanguage();

  const isUploading = video.status === 'UPLOADING';
  const isFailed = video.status === 'FAILED';
  const isReady = video.status === 'READY';

  const dateFormatter = React.useMemo(() => {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }, [language]);

  return (
    <li className="group flex flex-col overflow-hidden rounded-xl border border-border bg-surface text-text shadow-sm transition-all duration-150 hover:border-border-strong">
      {/* 16:9 Thumbnail Poster */}
      <div className="relative aspect-video w-full overflow-hidden bg-surface-2 select-none">
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            className={`h-full w-full object-cover transition-transform duration-200 group-hover:scale-102 ${
              isUploading ? 'blur-xs opacity-75' : ''
            }`}
            src={video.thumbnailUrl}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <FilmIcon />
          </div>
        )}

        {/* Failed overlay */}
        {isFailed && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/60 backdrop-blur-xs">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-danger text-on-accent text-lg font-bold shadow-md"
            >
              !
            </span>
          </div>
        )}

        {/* Uploading overlay */}
        {isUploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg/50 px-4 text-center text-xs font-medium text-text backdrop-blur-xs">
            {t('video.statusUploading')}...
          </div>
        )}

        {/* Reel count badge */}
        {video.reelCount > 0 && (
          <span className="absolute start-2 top-2 rounded-full bg-bg/80 border border-border px-2 py-0.5 text-[10px] font-semibold text-text backdrop-blur-xs">
            {video.reelCount} {language === 'ar' ? 'ريلز' : 'Reels'}
          </span>
        )}

        {/* Duration badge */}
        {video.durationSec ? (
          <span className="absolute bottom-2 end-2 rounded-md bg-bg/85 border border-border px-1.5 py-0.5 font-mono text-[11px] text-text backdrop-blur-xs">
            {formatDuration(video.durationSec)}
          </span>
        ) : null}
      </div>

      {/* Card Content Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Status & Date */}
        <div className="flex items-center justify-between gap-2 text-xs">
          {isReady ? (
            <Badge variant="accent">
              <span className="w-1.5 h-1.5 rounded-full bg-accent me-1" />
              {t('video.statusReady')}
            </Badge>
          ) : isFailed ? (
            <Badge variant="danger">
              <span className="w-1.5 h-1.5 rounded-full bg-danger me-1" />
              {t('video.statusFailed')}
            </Badge>
          ) : (
            <Badge variant="warning">
              <span className="w-1.5 h-1.5 rounded-full bg-warning me-1 animate-pulse" />
              {isUploading ? t('video.statusUploading') : t('workspace.inProgress')}
            </Badge>
          )}

          <span className="text-[11px] text-muted">
            {dateFormatter.format(new Date(video.createdAt))}
          </span>
        </div>

        {/* Title / Renaming form */}
        {mode === 'renaming' ? (
          <div className="mt-3 space-y-2">
            <Input
              autoFocus
              disabled={busy}
              id={`title-${video.id}`}
              maxLength={200}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && draftTitle.trim()) onSaveRename();
                if (e.key === 'Escape') onCancel();
              }}
              value={draftTitle}
            />
            <div className="flex justify-end gap-2">
              <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
                {t('common.cancel')}
              </Button>
              <Button
                disabled={busy || !draftTitle.trim()}
                isLoading={busy}
                onClick={onSaveRename}
                size="sm"
                variant="primary"
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <h2
            className="mt-3 line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-snug text-text"
            dir="auto"
          >
            {video.title}
          </h2>
        )}

        {/* Clips & Transcript Meta */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {isReady && (
            <span>
              {video.clipCount} {t('workspace.clipsCount').replace('{count}', '')}
            </span>
          )}
          <span>
            {video.transcriptReady
              ? (language === 'ar' ? 'النسخ جاهز' : 'Transcript ready')
              : video.transcriptionState === 'RUNNING' ||
                  video.transcriptionState === 'PENDING'
                ? `${language === 'ar' ? 'جاري النسخ' : 'Transcribing'}${
                    video.transcriptionProgress > 0
                      ? ` (${video.transcriptionProgress}%)`
                      : '...'
                  }`
                : ''}
          </span>
        </div>

        {/* Failure reason message */}
        {video.failureReason && (
          <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft p-2.5 text-xs text-danger" role="alert">
            {video.failureReason}
          </div>
        )}

        {/* Delete Confirmation or Actions Footer */}
        {mode === 'confirming-delete' ? (
          <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger" role="alertdialog">
            <p className="font-medium">
              {language === 'ar'
                ? 'هل تريد بالتأكيد حذف هذا الفيديو؟ لا يمكن التراجع عن هذا الإجراء.'
                : 'Delete this video? This cannot be undone.'}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
                {t('common.cancel')}
              </Button>
              <Button
                disabled={busy}
                isLoading={busy}
                onClick={onConfirmDelete}
                size="sm"
                variant="danger"
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-auto pt-4 flex items-center justify-between border-t border-border">
            {isReady ? (
              <Link
                className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
                href={`/videos/${video.id}`}
              >
                <span>{language === 'ar' ? 'فتح المحرر' : 'Open Editor'}</span>
                <span aria-hidden="true">→</span>
              </Link>
            ) : isFailed || isUploading ? (
              <Link
                className="text-xs font-semibold text-warning hover:underline flex items-center gap-1"
                href="/videos/new"
              >
                <span>{isFailed ? t('common.retry') : (language === 'ar' ? 'استئناف' : 'Resume')}</span>
                <span aria-hidden="true">↻</span>
              </Link>
            ) : (
              <span className="text-xs text-muted">
                {language === 'ar' ? 'قيد المعالجة...' : 'Processing...'}
              </span>
            )}

            <div className="flex items-center gap-1">
              {mode === 'view' && isReady && (
                <button
                  aria-label={`Rename ${video.title}`}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text transition-colors disabled:opacity-50"
                  disabled={busy}
                  onClick={onBeginRename}
                  type="button"
                >
                  <PencilIcon />
                </button>
              )}
              <button
                aria-label={`Delete ${video.title}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger transition-colors disabled:opacity-50"
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

function FilmIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8 opacity-40"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <rect height="18" rx="2" width="18" x="3" y="3" />
      <path d="M7 3v18" />
      <path d="M17 3v18" />
      <path d="M3 7.5h4" />
      <path d="M3 12h18" />
      <path d="M3 16.5h4" />
      <path d="M17 7.5h4" />
      <path d="M17 16.5h4" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
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
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M6 6l1 14h10l1-14" />
    </svg>
  );
}
