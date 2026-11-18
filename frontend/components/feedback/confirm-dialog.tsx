'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Short label for what is affected, shown in a highlighted row. */
  subject?: string;
  subjectDir?: 'auto' | 'rtl' | 'ltr';
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONES = {
  danger: {
    bar: 'bg-rose-500',
    button:
      'bg-rose-600 hover:bg-rose-500 text-white font-bold shadow-md shadow-rose-600/20',
  },
  warning: {
    bar: 'bg-amber-500',
    button:
      'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold shadow-md shadow-emerald-500/20',
  },
};

export function ConfirmDialog({
  open,
  title,
  subject,
  subjectDir = 'auto',
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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
  const style = TONES[tone];

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
        className="w-full max-w-md overflow-hidden rounded-2xl bg-zinc-900/95 border border-zinc-800 shadow-2xl text-zinc-100 backdrop-blur-xl"
        ref={panelRef}
        role="alertdialog"
      >
        <div className={`h-1 ${style.bar}`} />
        <div className="p-5">
          <h2 className="text-lg font-bold text-zinc-100" id={titleId}>
            {title}
          </h2>
          {subject ? (
            <p
              className="mt-3 rounded-lg border border-zinc-700/60 bg-zinc-800/80 px-3 py-2 font-[family-name:var(--font-cairo)] text-sm font-semibold text-zinc-100"
              dir={subjectDir}
            >
              {subject}
            </p>
          ) : null}
          <div className="mt-3 text-sm text-zinc-400" id={bodyId}>
            {children}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              className="h-9 rounded-lg border border-zinc-700 bg-zinc-800 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
              disabled={busy}
              onClick={onCancel}
              ref={cancelRef}
              type="button"
            >
              {cancelLabel}
            </button>
            <button
              className={`h-9 rounded-lg px-4 text-sm disabled:opacity-50 transition-colors ${style.button}`}
              disabled={busy}
              onClick={onConfirm}
              type="button"
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
