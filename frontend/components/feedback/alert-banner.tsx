'use client';

import { useState, type ReactNode } from 'react';

export type AlertVariant = 'error' | 'warning' | 'info' | 'success';

const STYLES: Record<
  AlertVariant,
  { box: string; title: string; icon: string; glyph: string }
> = {
  error: {
    box: 'border-[#c44932] bg-[#fff2ef] text-[#8f2f1f]',
    title: 'text-[#8f2f1f]',
    icon: 'bg-[#b42318] text-white',
    glyph: '!',
  },
  warning: {
    box: 'border-[#c9811a] bg-[#fff8ea] text-[#7a4a06]',
    title: 'text-[#7a4a06]',
    icon: 'bg-[#c9811a] text-white',
    glyph: '!',
  },
  info: {
    box: 'border-[#2f7f9a] bg-[#eef7fb] text-[#1d566a]',
    title: 'text-[#1d566a]',
    icon: 'bg-[#2f7f9a] text-white',
    glyph: 'i',
  },
  success: {
    box: 'border-[#0f766e] bg-[#e4f3ef] text-[#0b5a54]',
    title: 'text-[#0b5a54]',
    icon: 'bg-[#0f766e] text-white',
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
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-white/70 px-2.5 py-1.5 text-xs">
            <span className="font-medium">Reference</span>
            <code className="font-mono">{diagnosticKey}</code>
            <button
              className="rounded px-1.5 py-0.5 font-semibold underline underline-offset-2 hover:bg-white"
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
          className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-base leading-none hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
