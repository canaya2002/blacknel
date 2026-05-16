'use client';

import { useEffect } from 'react';

import { fireToast } from './toast';

/**
 * Keyboard-shortcut primitives for Blacknel.
 *
 * The single hook `useKeyboardShortcuts({ ...handlers })` registers a
 * `keydown` listener on `window`. Events fired while the focus is in
 * a form input (`input`, `textarea`, or any contenteditable) are
 * IGNORED — you don't want `c` to close a thread while the user is
 * typing "como estas" in the composer.
 *
 * Modifier keys (alt, ctrl, meta, shift) also disable the shortcut so
 * legitimate browser shortcuts (`cmd+c`, `cmd+r`, etc.) keep working.
 * The single exception is `cmd+k` (`useCmdKShortcut`) which captures
 * the modifier on purpose.
 */

type ShortcutKey = 'j' | 'k' | 'r' | 'a' | 'e' | 'c';

export interface UseKeyboardShortcutsOptions {
  readonly enabled?: boolean;
  readonly handlers: Partial<Record<ShortcutKey, () => void>>;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  // `isContentEditable` is the canonical check, but jsdom returns
  // `false` for it even when the attribute is set. Fall back to the
  // attribute value so tests and real browsers behave the same.
  if (target.isContentEditable) return true;
  const attr = target.getAttribute('contenteditable');
  if (attr === '' || attr === 'true') return true;
  return false;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const { enabled = true, handlers } = options;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase() as ShortcutKey;
      const handler = handlers[key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, handlers]);
}

/**
 * Global `cmd+k` / `ctrl+k` handler. Phase 4 fires a toast and tries
 * to focus the page's filters bar; Phase 5 will replace the body with
 * the real global search modal — the listener stays mounted in the
 * shell.
 */
export function useCmdKShortcut(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKeyDown = (event: KeyboardEvent): void => {
      const isCmd = event.metaKey || event.ctrlKey;
      if (!isCmd) return;
      if (event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      // Phase-4 behaviour: tell the user what cmd+k will do (Phase 5)
      // and route them to whatever filtering is on the current page.
      fireToast({
        message:
          'Búsqueda global llega en Fase 5. Por ahora cmd+k enfoca los filtros de esta vista.',
        tone: 'info',
      });
      focusFiltersBar();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

function focusFiltersBar(): void {
  if (typeof document === 'undefined') return;
  const bar = document.querySelector<HTMLElement>('[data-testid="filters-bar"]');
  if (!bar) return;
  // Prefer the first text input (search box on /inbox) — otherwise
  // any tabbable element inside the bar.
  const input = bar.querySelector<HTMLInputElement | HTMLButtonElement>(
    'input, [role="combobox"], button',
  );
  input?.focus();
}
