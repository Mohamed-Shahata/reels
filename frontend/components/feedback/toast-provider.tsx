'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AlertVariant } from './alert-banner';

export interface ToastInput {
  variant?: AlertVariant;
  title: string;
  description?: string;
  /** Milliseconds before auto-dismiss. Errors stay longer. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
  variant: AlertVariant;
}

interface ToastContextValue {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

// Without a provider (e.g. isolated component tests) toasts are no-ops.
const ToastContext = createContext<ToastContextValue>({
  show: () => 0,
  dismiss: () => {},
});

const ACCENT: Record<AlertVariant, string> = {
  success: 'bg-[#0f766e]',
  error: 'bg-[#b42318]',
  warning: 'bg-[#c9811a]',
  info: 'bg-[#2f7f9a]',
};

const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const variant = input.variant ?? 'success';
      const duration = input.duration ?? (variant === 'error' ? 8000 : 4000);
      setToasts((current) =>
        [...current, { ...input, id, variant }].slice(-MAX_VISIBLE),
      );
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), duration),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const active = timers.current;
    return () => active.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-atomic="false"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            className="pointer-events-auto flex overflow-hidden rounded-lg border border-[#dfe6e2] bg-white shadow-lg"
            key={toast.id}
            role={toast.variant === 'error' ? 'alert' : 'status'}
          >
            <span className={`w-1 shrink-0 ${ACCENT[toast.variant]}`} />
            <div className="min-w-0 flex-1 px-3 py-2.5">
              <p className="text-sm font-semibold text-[#172321]">
                {toast.title}
              </p>
              {toast.description ? (
                <p className="mt-0.5 text-xs text-[#5d6d68]" dir="auto">
                  {toast.description}
                </p>
              ) : null}
            </div>
            <button
              aria-label="Dismiss notification"
              className="m-1.5 h-6 w-6 shrink-0 rounded text-base leading-none text-[#5d6d68] hover:bg-[#f2f6f4]"
              onClick={() => dismiss(toast.id)}
              type="button"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
