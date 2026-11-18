'use client';

import { useEffect, useId, useRef } from 'react';
import type { AiClipMode } from '@/lib/api';

export interface AiClipsDialogProps {
  open: boolean;
  mode: AiClipMode;
  /** AI clips already on the video; they are replaced by the new run. */
  existingAiClips: number;
  busy?: boolean;
  onModeChange: (mode: AiClipMode) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export const AI_CLIP_MODE_OPTIONS: {
  mode: AiClipMode;
  title: string;
  description: string;
}[] = [
  {
    mode: 'FULL',
    title: 'The whole podcast',
    description:
      'Cut the entire episode into back-to-back clips, one per topic, with no gaps.',
  },
  {
    mode: 'HIGHLIGHTS',
    title: 'Important parts only',
    description:
      'Keep only the moments most likely to get reach: strong hooks, stories, insights and bold opinions.',
  },
];

export function AiClipsDialog({
  open,
  mode,
  existingAiClips,
  busy = false,
  onModeChange,
  onConfirm,
  onCancel,
}: AiClipsDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        event.stopPropagation();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        aria-describedby={bodyId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-2xl text-zinc-100 backdrop-blur-xl"
        ref={panelRef}
        role="dialog"
      >
        <div className="h-1 bg-gradient-to-r from-emerald-600 via-emerald-400 to-teal-500" />
        <div className="p-5">
          <h2 className="text-lg font-bold text-zinc-100" id={titleId}>
            Generate clips with AI
          </h2>
          <p className="mt-1 text-sm text-zinc-400" id={bodyId}>
            What should the AI cut from this podcast? Clips last one to four
            minutes and never end while someone is still speaking or in the
            middle of a topic.
          </p>

          <div
            aria-label="What to clip"
            className="mt-4 grid gap-2"
            role="radiogroup"
          >
            {AI_CLIP_MODE_OPTIONS.map((option) => {
              const active = option.mode === mode;
              return (
                <button
                  aria-checked={active}
                  className={`rounded-xl border px-4 py-3 text-left transition disabled:opacity-50 ${
                    active
                      ? 'border-emerald-500/80 bg-emerald-500/10 ring-1 ring-emerald-500/50'
                      : 'border-zinc-800 bg-zinc-800/50 hover:bg-zinc-800/80 hover:border-zinc-700'
                  }`}
                  disabled={busy}
                  key={option.mode}
                  onClick={() => onModeChange(option.mode)}
                  role="radio"
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        active ? 'border-emerald-500' : 'border-zinc-600'
                      }`}
                    >
                      {active ? (
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      ) : null}
                    </span>
                    <span className="text-sm font-semibold text-zinc-100">
                      {option.title}
                    </span>
                  </span>
                  <span className="mt-1 block pl-6 text-xs text-zinc-400">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-zinc-400">
            Uses one AI run. A topic longer than four minutes is split into
            parts.
          </p>
          {existingAiClips > 0 ? (
            <p className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
              This replaces your {existingAiClips} current AI clip
              {existingAiClips === 1 ? '' : 's'}. Clips you edited or created
              manually are kept.
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button
              className="h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
              disabled={busy}
              onClick={onCancel}
              ref={cancelRef}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-9 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-zinc-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20 disabled:opacity-50 transition-colors"
              disabled={busy}
              onClick={onConfirm}
              type="button"
            >
              {busy
                ? 'Generating…'
                : existingAiClips > 0
                  ? 'Replace and generate'
                  : 'Generate clips'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
