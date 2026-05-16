'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Minimal toast surface. Listens for `window.dispatchEvent(new
 * CustomEvent('blacknel:toast', { detail: { message, tone } }))` and
 * renders the most recent toast in a bottom-right region.
 *
 * No external dep — we resisted pulling in sonner / react-hot-toast
 * because the Phase-4 surface is one cmd+k notice. If a heavier toast
 * UX is ever needed (queue, dismiss-all, action buttons) swap to
 * shadcn's sonner integration; the dispatch API stays the same.
 */

export type ToastTone = 'info' | 'success' | 'error' | 'warning';

export interface BlacknelToastDetail {
  readonly message: string;
  readonly tone?: ToastTone;
  /** Auto-dismiss after this many ms. Defaults to 3500. */
  readonly durationMs?: number;
}

const EVENT_NAME = 'blacknel:toast';

export function fireToast(detail: BlacknelToastDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BlacknelToastDetail>(EVENT_NAME, { detail }));
}

export function ToastRegion(): React.ReactElement | null {
  const [toast, setToast] = useState<BlacknelToastDetail | null>(null);

  useEffect(() => {
    const handler = (event: Event): void => {
      const ev = event as CustomEvent<BlacknelToastDetail>;
      setToast(ev.detail);
    };
    window.addEventListener(EVENT_NAME, handler as EventListener);
    return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toast.durationMs ?? 3500);
    return () => clearTimeout(id);
  }, [toast]);

  if (!toast) return null;

  const toneClass = {
    info: 'border-zinc-500/40 bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100',
    success:
      'border-emerald-500/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100',
    error: 'border-red-500/40 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100',
    warning:
      'border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  }[toast.tone ?? 'info'];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-auto fixed bottom-4 right-4 z-50 flex max-w-sm items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-lg ${toneClass}`}
    >
      <span className="flex-1 leading-relaxed">{toast.message}</span>
      <button
        type="button"
        onClick={() => setToast(null)}
        aria-label="Cerrar"
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-foreground/10"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
