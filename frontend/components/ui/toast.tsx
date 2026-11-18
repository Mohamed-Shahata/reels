'use client';

import * as React from 'react';

export interface ToastProps {
  id: string;
  title?: string;
  message: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
  onDismiss: (id: string) => void;
}

export function ToastItem({
  id,
  title,
  message,
  variant = 'info',
  onDismiss,
}: ToastProps) {
  const variantStyles = {
    info: 'border-info/30 bg-surface-2 text-text',
    success: 'border-accent/30 bg-surface-2 text-text',
    warning: 'border-warning/30 bg-surface-2 text-text',
    error: 'border-danger/30 bg-surface-2 text-text',
  };

  const iconColors = {
    info: 'text-info',
    success: 'text-accent',
    warning: 'text-warning',
    error: 'text-danger',
  };

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 p-4 rounded-xl border shadow-xl max-w-sm w-full transition-all duration-200 animate-in fade-in slide-in-from-top-2 ${variantStyles[variant]}`}
    >
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span
          className={`inline-block w-2 h-2 rounded-full mt-1.5 shrink-0 ${iconColors[variant]} bg-current`}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0 space-y-0.5">
          {title && (
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              {title}
            </p>
          )}
          <p className="text-sm text-text break-words leading-snug">{message}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(id)}
        className="text-muted hover:text-text p-1 -m-1 rounded-md transition-colors"
        aria-label="Dismiss"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
