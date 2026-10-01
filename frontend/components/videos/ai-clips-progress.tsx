'use client';

import { useEffect, useState } from 'react';
import type { AiClipMode } from '@/lib/api';

export interface AiClipsProgressProps {
  /** True while the AI request is running. */
  active: boolean;
  mode: AiClipMode;
}

/** Progress never claims more than this until the request really finishes. */
const CEILING = 95;
/** Time constant of the easing curve; AI runs usually take 20-60 seconds. */
const TAU_MS = 25_000;

const STAGES = [
  { from: 0, label: 'Reading the transcript' },
  { from: 20, label: 'Finding topic boundaries' },
  { from: 55, label: 'Picking the best clips' },
  { from: 85, label: 'Saving your clips' },
];

/**
 * The AI endpoint reports no percentage, so while it runs the bar eases
 * towards CEILING and jumps to 100% once the request resolves.
 */
export function estimateAiProgress(elapsedMs: number): number {
  const fraction = 1 - Math.exp(-Math.max(elapsedMs, 0) / TAU_MS);
  return Math.min(CEILING, Math.round(CEILING * fraction));
}

export function AiClipsProgress({ active, mode }: AiClipsProgressProps) {
  const [progress, setProgress] = useState(active ? 2 : 0);
  const [wasActive, setWasActive] = useState(active);

  // Reset when a run starts or stops (derived during render, not in an effect).
  if (active !== wasActive) {
    setWasActive(active);
    setProgress(active ? 2 : 0);
  }

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setProgress(Math.max(2, estimateAiProgress(Date.now() - startedAt)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;

  const stage = [...STAGES].reverse().find((item) => progress >= item.from);

  return (
    <section
      aria-label="AI clips status"
      aria-live="polite"
      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-[#e2eae6] bg-white px-5 py-3 shadow-[var(--shadow-surface)]"
    >
      <span className="inline-flex items-center gap-2 text-sm font-bold text-[#0f766e]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
        {mode === 'HIGHLIGHTS'
          ? 'Finding important parts'
          : 'Cutting the whole podcast'}{' '}
        {progress}%
      </span>
      <div
        aria-label="AI clips progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={progress}
        className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-[#e3ece8]"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-[#0f766e] transition-[width] duration-500 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="text-xs text-[#5d6d68]">{stage?.label}…</span>
    </section>
  );
}
