'use client';

import { useState } from 'react';

export function CopyUrlButton() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      className="font-mono text-xs font-semibold text-[#0f766e] hover:underline"
      onClick={() => void copy()}
      type="button"
    >
      {copied ? 'Copied' : 'Copy URL'}
    </button>
  );
}
