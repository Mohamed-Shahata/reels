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
          success ? 'bg-[#0f766e]' : 'bg-[#b42318]'
        }`}
      />
      <span
        aria-hidden="true"
        className={`absolute inset-3 rounded-full opacity-25 ${
          success ? 'bg-[#0f766e]' : 'bg-[#b42318]'
        }`}
      />
      <span
        className={`relative flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg ${
          success
            ? 'bg-[#0f766e] shadow-[#0f766e]/30'
            : 'bg-[#b42318] shadow-[#b42318]/30'
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
  'h-9 rounded-lg border border-[#d5dcd8] bg-white px-4 text-sm font-medium text-[#263532] hover:bg-[#f6f8f7] disabled:cursor-not-allowed disabled:opacity-50';
const primaryBtn =
  'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#0b5a54] disabled:cursor-not-allowed disabled:bg-[#8ba7a0]';

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
      ? 'bg-[#b42318]'
      : phase === 'success'
        ? 'bg-[#0f766e]'
        : 'bg-[#0f766e]';
  const percent =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1f1c]/55 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !working) onClose();
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl"
        role="dialog"
      >
        <div className={`h-1 ${barColor}`} />

        {phase === 'confirm' ? (
          <div className="p-5">
            <h2
              className="flex items-center gap-2 text-lg font-bold text-[#172321]"
              id={titleId}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e4f3ef] text-[#0f766e]">
                <DownloadIcon />
              </span>
              Download {zip ? `${items.length} clips` : 'clip'}
            </h2>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-[#f2f6f4] px-3 py-2 text-xs text-[#44534e]">
              <span className="rounded-full bg-white px-2 py-0.5 font-semibold text-[#0f766e] ring-1 ring-[#d5e2dc]">
                {aspect}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 font-semibold ring-1 ring-[#d5e2dc]">
                {subtitlesOn ? 'With subtitles' : 'No subtitles'}
              </span>
              <span className="rounded-full bg-white px-2 py-0.5 font-semibold ring-1 ring-[#d5e2dc]">
                {zip ? 'ZIP file' : 'MP4 file'}
              </span>
            </div>

            <ol
              aria-label="Clips to download"
              className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1"
            >
              {items.map((item) => (
                <li
                  className="flex items-center gap-2 rounded-lg border border-[#e2eae6] bg-[#fafcfb] px-2.5 py-1.5 text-sm"
                  key={item.id}
                >
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0f766e] px-1.5 text-[11px] font-bold text-white">
                    {item.number}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-semibold"
                    dir="auto"
                    style={cairo}
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  <span className="shrink-0 text-xs text-[#5d6d68]">
                    {item.length}
                  </span>
                  {item.note ? (
                    <span className="shrink-0 rounded-full bg-[#fff4e0] px-1.5 py-0.5 text-[10px] font-semibold text-[#8a5a00]">
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
              <span className="text-sm font-semibold">Version</span>
              <div className="flex rounded-lg border border-[#d5e2dc] bg-[#f6f8f7] p-0.5 text-xs font-semibold">
                {(['9:16', '16:9'] as const).map((value) => (
                  <button
                    aria-pressed={aspect === value}
                    className={`rounded-md px-3 py-1 ${
                      aspect === value
                        ? 'bg-white text-[#0f766e] shadow-sm'
                        : 'text-[#5d6d68] hover:text-[#0f766e]'
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
              className={`mt-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 ${
                subtitlesLocked
                  ? 'border-[#e2eae6] bg-[#f6f8f7] opacity-70'
                  : 'cursor-pointer border-[#d5e2dc] hover:border-[#0f766e]'
              }`}
            >
              <span>
                <span className="block text-sm font-semibold">
                  Download with subtitles
                </span>
                <span className="block text-xs text-[#5d6d68]">
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
                <span className="absolute inset-0 rounded-full bg-[#c9d6d0] transition-colors peer-checked:bg-[#0f766e] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#0f766e]" />
                <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>

            {subtitlesOn && renderCount > 0 ? (
              <p className="mt-2 rounded-lg bg-[#fff4e0] px-3 py-2 text-xs text-[#8a5a00]">
                {renderCount === 1
                  ? '1 clip has no subtitled reel yet'
                  : `${renderCount} clips have no subtitled reel yet`}
                . They will be rendered first, which can take a few minutes.
              </p>
            ) : null}

            <p className="mt-3 truncate text-xs text-[#5d6d68]" dir="auto">
              Saved as{' '}
              <span className="font-semibold text-[#263532]">{fileName}</span>
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
              <span className="h-14 w-14 animate-spin rounded-full border-4 border-[#dce6e1] border-t-[#0f766e] motion-reduce:animate-none" />
            </div>
            <p className="mt-2 text-base font-bold text-[#172321]">
              {progressLabel ?? 'Preparing your download...'}
            </p>
            <p className="mt-1 text-xs text-[#5d6d68]">
              Keep this tab open. The file will start downloading when it is
              ready.
            </p>
            {percent !== null ? (
              <div
                aria-label="Download progress"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={percent}
                className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-[#e3ece8]"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-[#0f766e] transition-[width] duration-500"
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
            <h2 className="mt-2 text-xl font-bold text-[#172321]" id={titleId}>
              Download started
            </h2>
            <p className="mt-1 text-sm text-[#44534e]">
              {zip
                ? `${items.length - skippedCount} clips are in your ZIP file.`
                : 'Your clip is saving to your device.'}
            </p>
            <p
              className="mx-auto mt-3 max-w-full truncate rounded-lg bg-[#f2f6f4] px-3 py-2 text-xs font-semibold text-[#263532]"
              dir="auto"
            >
              {fileName}
            </p>
            {skippedCount > 0 ? (
              <p className="mt-3 rounded-lg bg-[#fff4e0] px-3 py-2 text-xs text-[#8a5a00]">
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
            <h2 className="mt-2 text-xl font-bold text-[#172321]" id={titleId}>
              Download failed
            </h2>
            <p className="mt-1 text-sm text-[#44534e]">
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
