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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1f1c]/55 px-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        aria-describedby={bodyId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl"
        ref={panelRef}
        role="dialog"
      >
        <div className="h-1 bg-[#0f766e]" />
        <div className="p-5">
          <h2 className="text-lg font-bold text-[#172321]" id={titleId}>
            Generate clips with AI
          </h2>
          <p className="mt-1 text-sm text-[#44534e]" id={bodyId}>
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
                  className={`rounded-lg border px-4 py-3 text-left transition disabled:opacity-50 ${
                    active
                      ? 'border-[#0f766e] bg-[#f0f8f6] ring-1 ring-[#0f766e]'
                      : 'border-[#d5dcd8] bg-white hover:bg-[#f6f8f7]'
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
                        active ? 'border-[#0f766e]' : 'border-[#9aa8a3]'
                      }`}
                    >
                      {active ? (
                        <span className="h-2 w-2 rounded-full bg-[#0f766e]" />
                      ) : null}
                    </span>
                    <span className="text-sm font-semibold text-[#172321]">
                      {option.title}
                    </span>
                  </span>
                  <span className="mt-1 block pl-6 text-xs text-[#5d6d68]">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-[#5d6d68]">
            Uses one AI run. A topic longer than four minutes is split into
            parts.
          </p>
          {existingAiClips > 0 ? (
            <p className="mt-2 rounded-lg bg-[#fdf4e3] px-3 py-2 text-xs text-[#7a4f0c]">
              This replaces your {existingAiClips} current AI clip
              {existingAiClips === 1 ? '' : 's'}. Clips you edited or created
              manually are kept.
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2">
            <button
              className="h-9 rounded-lg border border-[#d5dcd8] bg-white px-4 text-sm font-medium text-[#263532] hover:bg-[#f6f8f7] disabled:opacity-50"
              disabled={busy}
              onClick={onCancel}
              ref={cancelRef}
              type="button"
            >
              Cancel
            </button>
            <button
              className="h-9 rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#0b5a54] disabled:opacity-50"
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
