'use client';

import { useState, type ReactNode } from 'react';

export type AlertVariant = 'error' | 'warning' | 'info' | 'success';

const STYLES: Record<
  AlertVariant,
  { box: string; title: string; icon: string; glyph: string }
> = {
  error: {
    box: 'border-destructive/40 bg-destructive/10 text-destructive',
    title: 'text-destructive',
    icon: 'bg-destructive text-destructive-foreground',
    glyph: '!',
  },
  warning: {
    box: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
    title: 'text-amber-500',
    icon: 'bg-amber-500 text-white',
    glyph: '!',
  },
  info: {
    box: 'border-sky-500/40 bg-sky-500/10 text-sky-500',
    title: 'text-sky-500',
    icon: 'bg-sky-500 text-white',
    glyph: 'i',
  },
  success: {
    box: 'border-primary/40 bg-primary/10 text-primary',
    title: 'text-primary',
    icon: 'bg-primary text-primary-foreground',
    glyph: '✓',
  },
};

export interface AlertBannerProps {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
  /** Support reference shown in a copyable row, e.g. an error id. */
  diagnosticKey?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

export function AlertBanner({
  variant = 'error',
  title,
  children,
  diagnosticKey,
  actions,
  onDismiss,
  className = '',
}: AlertBannerProps) {
  const style = STYLES[variant];
  const [copied, setCopied] = useState(false);

  async function copyKey() {
    if (!diagnosticKey) return;
    try {
      await navigator.clipboard.writeText(diagnosticKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border-l-2 px-3.5 py-3 text-sm ${style.box} ${className}`}
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
    >
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.icon}`}
      >
        {style.glyph}
      </span>
      <div className="min-w-0 flex-1">
        {title ? (
          <p className={`font-semibold ${style.title}`}>{title}</p>
        ) : null}
        {children ? (
          <div className={title ? 'mt-0.5' : ''}>{children}</div>
        ) : null}
        {diagnosticKey ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-muted/70 px-2.5 py-1.5 text-xs">
            <span className="font-medium">Reference</span>
            <code className="font-mono">{diagnosticKey}</code>
            <button
              className="rounded px-1.5 py-0.5 font-semibold underline underline-offset-2 hover:bg-muted"
              onClick={() => void copyKey()}
              type="button"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        ) : null}
        {actions ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
      {onDismiss ? (
        <button
          aria-label="Dismiss"
          className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-base leading-none hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
