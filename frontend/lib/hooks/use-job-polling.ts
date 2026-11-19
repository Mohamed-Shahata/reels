'use client';

import { useEffect, useRef, useCallback } from 'react';

interface UseJobPollingOptions {
  enabled?: boolean;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  backoffFactor?: number;
  onPoll: () => Promise<boolean | void>; // return true if active/changed to reset backoff
}

export function useJobPolling({
  enabled = true,
  minIntervalMs = 2500,
  maxIntervalMs = 10000,
  backoffFactor = 1.5,
  onPoll,
}: UseJobPollingOptions) {
  const currentIntervalRef = useRef(minIntervalMs);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef(false);
  const isVisibleRef = useRef(true);
  const onPollRef = useRef(onPoll);

  useEffect(() => {
    onPollRef.current = onPoll;
  }, [onPoll]);

  const scheduleNextRef = useRef<(delayMs: number) => void>(() => {});

  const executePoll = useCallback(async () => {
    if (isPollingRef.current || !enabled) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    isPollingRef.current = true;
    try {
      const hasActiveWork = await onPollRef.current();
      if (hasActiveWork) {
        currentIntervalRef.current = minIntervalMs;
      } else {
        currentIntervalRef.current = Math.min(
          currentIntervalRef.current * backoffFactor,
          maxIntervalMs,
        );
      }
    } catch {
      currentIntervalRef.current = Math.min(
        currentIntervalRef.current * backoffFactor,
        maxIntervalMs,
      );
    } finally {
      isPollingRef.current = false;
      if (enabled && isVisibleRef.current) {
        scheduleNextRef.current(currentIntervalRef.current);
      }
    }
  }, [enabled, minIntervalMs, maxIntervalMs, backoffFactor]);

  const scheduleNext = useCallback(
    (delayMs: number) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (!enabled) return;

      timerRef.current = setTimeout(() => {
        void executePoll();
      }, delayMs);
    },
    [enabled, executePoll],
  );

  useEffect(() => {
    scheduleNextRef.current = scheduleNext;
  }, [scheduleNext]);

  const pollNow = useCallback(() => {
    currentIntervalRef.current = minIntervalMs;
    void executePoll();
  }, [minIntervalMs, executePoll]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      isVisibleRef.current = isVisible;

      if (isVisible && enabled) {
        pollNow();
      } else if (!isVisible && timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, pollNow]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    void executePoll();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, executePoll]);

  return { pollNow };
}
