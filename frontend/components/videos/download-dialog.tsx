'use client';

import { useEffect, useId, useRef } from 'react';

export type DownloadPhase = 'confirm' | 'working' | 'success' | 'error';
export type DownloadAspect = '9:16' | '16:9';

export interface DownloadSummaryItem {
  id: string;
  number: number;
  title: string;
  length: string;
  /** Extra note shown next to the clip, e.g. "Will be rendered". */
  note?: string | null;
}

export interface DownloadDialogProps {
  open: boolean;
  phase: DownloadPhase;
  items: DownloadSummaryItem[];
  aspect: DownloadAspect;
  onAspectChange: (aspect: DownloadAspect) => void;
  subtitles: boolean;
  onSubtitlesChange: (enabled: boolean) => void;
  /** False when the video has no transcript or no subtitle style yet. */
  subtitlesAvailable: boolean;
  /** Name of the single file or of the zip that will be saved. */
  fileName: string;
  /** Clips that must be rendered first (only with subtitles). */
  renderCount: number;
  /** Shown while working, e.g. "Downloading 2 of 5". */
  progressLabel: string | null;
  progress: { done: number; total: number } | null;
  /** Shown on the success screen when some clips were skipped. */
  skippedCount: number;
  errorMessage: string | null;
  onConfirm: () => void;
  onRetry: () => void;
  /** Stops waiting for renders while working. */
  onCancel: () => void;
  onClose: () => void;
}

const cairo = { fontFamily: 'var(--font-cairo), sans-serif' };

function DownloadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function ResultBadge({ kind }: { kind: 'success' | 'error' }) {
  const success = kind === 'success';
  return (
    <div className="relative mx-auto flex h-24 w-24 items-center justify-center">
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full opacity-20 ${
          success ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />
      <span
        aria-hidden="true"
        className={`absolute inset-3 rounded-full opacity-25 ${
          success ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />
      <span
        className={`relative flex h-16 w-16 items-center justify-center rounded-full text-zinc-950 shadow-lg ${
          success
            ? 'bg-emerald-500 shadow-emerald-500/30'
            : 'bg-rose-500 text-white shadow-rose-500/30'
        }`}
      >
        <svg
          aria-hidden="true"
          fill="none"
          height="34"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          viewBox="0 0 24 24"
          width="34"
        >
          {success ? (
            <polyline points="5 12.5 10 17.5 19 7.5" />
          ) : (
            <>
              <line x1="6" x2="18" y1="6" y2="18" />
              <line x1="18" x2="6" y1="6" y2="18" />
            </>
          )}
        </svg>
      </span>
    </div>
  );
}

const secondaryBtn =
  'h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors';
const primaryBtn =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-zinc-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none transition-colors';

export function DownloadDialog({
  open,
  phase,
  items,
  aspect,
  onAspectChange,
  subtitles,
  onSubtitlesChange,
  subtitlesAvailable,
  fileName,
  renderCount,
  progressLabel,
  progress,
  skippedCount,
  errorMessage,
  onConfirm,
  onRetry,
  onCancel,
  onClose,
}: DownloadDialogProps) {
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const working = phase === 'working';
  const subtitlesLocked = !subtitlesAvailable || aspect !== '9:16';
  const subtitlesOn = subtitles && !subtitlesLocked;
  const zip = items.length > 1;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !working) {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, working, onClose]);

  useEffect(() => {
    if (open) primaryRef.current?.focus();
  }, [open, phase]);

  if (!open) return null;

  const barColor =
    phase === 'error'
      ? 'bg-rose-500'
      : phase === 'success'
        ? 'bg-emerald-500'
        : 'bg-gradient-to-r from-emerald-600 via-emerald-400 to-teal-500';
  const percent =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-2xl text-zinc-100 backdrop-blur-xl"
        role="dialog"
      >
        <div className={`h-1 ${barColor}`} />

        {phase === 'confirm' ? (
          <div className="p-5">
            <h2
              className="flex items-center gap-2 text-lg font-bold text-zinc-100"
              id={titleId}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <DownloadIcon />
              </span>
              Download {zip ? `${items.length} clips` : 'clip'}
            </h2>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-800/60 border border-zinc-800 px-3 py-2 text-xs text-zinc-300">
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-semibold text-emerald-400 border border-zinc-700">
                {aspect}
              </span>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-semibold border border-zinc-700">
                {subtitlesOn ? 'With subtitles' : 'No subtitles'}
              </span>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-semibold border border-zinc-700">
                {zip ? 'ZIP file' : 'MP4 file'}
              </span>
            </div>

            <ol
              aria-label="Clips to download"
              className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1"
            >
              {items.map((item) => (
                <li
                  className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-800/50 px-2.5 py-1.5 text-sm"
                  key={item.id}
                >
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-zinc-950">
                    {item.number}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-semibold text-zinc-200"
                    dir="auto"
                    style={cairo}
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {item.length}
                  </span>
                  {item.note ? (
                    <span className="shrink-0 rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                      {item.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>

            <div
              aria-label="Download version"
              className="mt-4 flex items-center justify-between gap-3"
              role="group"
            >
              <span className="text-sm font-semibold text-zinc-200">Version</span>
              <div className="flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-0.5 text-xs font-semibold">
                {(['9:16', '16:9'] as const).map((value) => (
                  <button
                    aria-pressed={aspect === value}
                    className={`rounded-md px-3 py-1 transition-colors ${
                      aspect === value
                        ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-zinc-700/60'
                        : 'text-zinc-400 hover:text-emerald-400'
                    }`}
                    key={value}
                    onClick={() => onAspectChange(value)}
                    type="button"
                  >
                    {value === '9:16' ? '9:16 Reel' : '16:9 Original'}
                  </button>
                ))}
              </div>
            </div>

            <label
              className={`mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                subtitlesLocked
                  ? 'border-zinc-800 bg-zinc-900/60 opacity-60'
                  : 'cursor-pointer border-zinc-800 bg-zinc-850 hover:border-emerald-500/50 hover:bg-zinc-800/60'
              }`}
            >
              <span>
                <span className="block text-sm font-semibold text-zinc-100">
                  Download with subtitles
                </span>
                <span className="block text-xs text-zinc-400">
                  {!subtitlesAvailable
                    ? 'Transcribe the video to add subtitles.'
                    : aspect !== '9:16'
                      ? 'Subtitles are only burned into 9:16 reels.'
                      : 'Uses your current subtitle style and edits.'}
                </span>
              </span>
              <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                <input
                  checked={subtitlesOn}
                  className="peer sr-only"
                  disabled={subtitlesLocked}
                  onChange={(event) => onSubtitlesChange(event.target.checked)}
                  role="switch"
                  type="checkbox"
                />
                <span className="absolute inset-0 rounded-full bg-zinc-700 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-500" />
                <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>

            {subtitlesOn && renderCount > 0 ? (
              <p className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                {renderCount === 1
                  ? '1 clip has no subtitled reel yet'
                  : `${renderCount} clips have no subtitled reel yet`}
                . They will be rendered first, which can take a few minutes.
              </p>
            ) : null}

            <p className="mt-3 truncate text-xs text-zinc-400" dir="auto">
              Saved as{' '}
              <span className="font-semibold text-zinc-200">{fileName}</span>
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button className={secondaryBtn} onClick={onClose} type="button">
                Cancel
              </button>
              <button
                className={primaryBtn}
                disabled={items.length === 0}
                onClick={onConfirm}
                ref={primaryRef}
                type="button"
              >
                <DownloadIcon />
                Download
              </button>
            </div>
          </div>
        ) : null}

        {working ? (
          <div aria-live="polite" className="p-6 text-center" role="status">
            <h2 className="sr-only" id={titleId}>
              Preparing your download
            </h2>
            <div className="mx-auto flex h-24 w-24 items-center justify-center">
              <span className="h-14 w-14 animate-spin rounded-full border-4 border-zinc-700 border-t-emerald-500 motion-reduce:animate-none" />
            </div>
            <p className="mt-2 text-base font-bold text-zinc-100">
              {progressLabel ?? 'Preparing your download...'}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Keep this tab open. The file will start downloading when it is
              ready.
            </p>
            {percent !== null ? (
              <div
                aria-label="Download progress"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={percent}
                className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-zinc-800"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                  style={{ width: `${Math.max(percent, 4)}%` }}
                />
              </div>
            ) : null}
            <div className="mt-5">
              <button
                className={secondaryBtn}
                onClick={onCancel}
                ref={primaryRef}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'success' ? (
          <div className="p-6 text-center" role="status">
            <ResultBadge kind="success" />
            <h2 className="mt-2 text-xl font-bold text-zinc-100" id={titleId}>
              Download started
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {zip
                ? `${items.length - skippedCount} clips are in your ZIP file.`
                : 'Your clip is saving to your device.'}
            </p>
            <p
              className="mx-auto mt-3 max-w-full truncate rounded-lg bg-zinc-800/80 border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200"
              dir="auto"
            >
              {fileName}
            </p>
            {skippedCount > 0 ? (
              <p className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
                {skippedCount === 1
                  ? '1 clip was skipped because it failed.'
                  : `${skippedCount} clips were skipped because they failed.`}
              </p>
            ) : null}
            <div className="mt-5">
              <button
                className={primaryBtn}
                onClick={onClose}
                ref={primaryRef}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="p-6 text-center" role="alert">
            <ResultBadge kind="error" />
            <h2 className="mt-2 text-xl font-bold text-zinc-100" id={titleId}>
              Download failed
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {errorMessage ?? 'Something went wrong. Please try again.'}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button className={secondaryBtn} onClick={onClose} type="button">
                Close
              </button>
              <button
                className={primaryBtn}
                onClick={onRetry}
                ref={primaryRef}
                type="button"
              >
                Try again
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
