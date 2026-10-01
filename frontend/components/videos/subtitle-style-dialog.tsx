'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface SubtitleStyleDialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Popup that holds the subtitle style editor. It sits on the right on wide
 * screens so the Viewport Stage on the left keeps showing the live preview.
 */
export function SubtitleStyleDialog({
  open,
  onClose,
  children,
}: SubtitleStyleDialogProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <button
        aria-label="Close subtitle style"
        className="hidden flex-1 cursor-default lg:block"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="flex h-full w-full flex-col bg-[#f6f8f7] shadow-2xl lg:w-[34rem]"
        role="dialog"
      >
        <div className="flex items-center justify-between border-b border-[#e2eae6] bg-white px-4 py-3">
          <h2 className="text-sm font-semibold" id={titleId}>
            Style Subtitles
          </h2>
          <button
            aria-label="Close"
            className="h-8 w-8 rounded-full border border-[#d8e1dc] text-base hover:border-[#0f766e]"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
