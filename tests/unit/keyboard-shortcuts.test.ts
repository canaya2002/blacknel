import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isEditableTarget } from '../../components/common/keyboard-shortcuts';

/**
 * Editable-target guard tests — the single most important property
 * of the keyboard-shortcut layer. If `c` closes a thread while the
 * user is typing "como estás" in the composer, we ship a bug.
 *
 * The hook itself runs against `window.keydown`; testing the React
 * lifecycle would require mounting a host. We assert the guard
 * directly (it's pure and exported) and validate the dispatch logic
 * via synthetic keydown events with mocked targets.
 */

let cleanup: Array<() => void> = [];

beforeEach(() => {
  cleanup = [];
});

afterEach(() => {
  for (const fn of cleanup) fn();
});

describe('isEditableTarget', () => {
  it('returns true for <textarea>', () => {
    const ta = document.createElement('textarea');
    expect(isEditableTarget(ta)).toBe(true);
  });

  it('returns true for <input>', () => {
    const inp = document.createElement('input');
    expect(isEditableTarget(inp)).toBe(true);
  });

  it('returns true for <select>', () => {
    const sel = document.createElement('select');
    expect(isEditableTarget(sel)).toBe(true);
  });

  it('returns true for contenteditable elements', () => {
    // jsdom doesn't propagate the `contentEditable` JS property to the
    // attribute, so we set the attribute directly — the same string a
    // real browser exposes when a real editor sets `contenteditable`.
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    cleanup.push(() => div.remove());
    expect(isEditableTarget(div)).toBe(true);
  });

  it('returns false for buttons / links / plain divs', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(document.createElement('a'))).toBe(false);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('shortcut dispatch via window keydown', () => {
  /**
   * Manually simulate the listener wiring `useKeyboardShortcuts`
   * installs. This sidesteps the React render harness while still
   * exercising the dispatch + guard logic.
   */
  function makeListener(handlers: Record<string, () => void>): (e: KeyboardEvent) => void {
    return (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      handlers[key]?.();
    };
  }

  it('fires the handler when the target is plain body', () => {
    const j = vi.fn();
    const listener = makeListener({ j });
    window.addEventListener('keydown', listener);
    cleanup.push(() => window.removeEventListener('keydown', listener));

    const ev = new KeyboardEvent('keydown', { key: 'j', bubbles: true });
    document.body.dispatchEvent(ev);
    expect(j).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire when the target is a textarea (composer typing)', () => {
    const j = vi.fn();
    const listener = makeListener({ j });
    window.addEventListener('keydown', listener);
    cleanup.push(() => window.removeEventListener('keydown', listener));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    cleanup.push(() => textarea.remove());

    const ev = new KeyboardEvent('keydown', { key: 'j', bubbles: true });
    textarea.dispatchEvent(ev);
    expect(j).not.toHaveBeenCalled();
  });

  it('does NOT fire on modifier-key combinations (so cmd+c, ctrl+r still work)', () => {
    const c = vi.fn();
    const listener = makeListener({ c });
    window.addEventListener('keydown', listener);
    cleanup.push(() => window.removeEventListener('keydown', listener));

    const ev = new KeyboardEvent('keydown', {
      key: 'c',
      bubbles: true,
      metaKey: true,
    });
    document.body.dispatchEvent(ev);
    expect(c).not.toHaveBeenCalled();
  });

  it('routes each key to its own handler', () => {
    const handlers = {
      j: vi.fn(),
      k: vi.fn(),
      r: vi.fn(),
      e: vi.fn(),
      c: vi.fn(),
    };
    const listener = makeListener(handlers);
    window.addEventListener('keydown', listener);
    cleanup.push(() => window.removeEventListener('keydown', listener));

    for (const key of ['j', 'k', 'r', 'e', 'c'] as const) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    expect(handlers.j).toHaveBeenCalledTimes(1);
    expect(handlers.k).toHaveBeenCalledTimes(1);
    expect(handlers.r).toHaveBeenCalledTimes(1);
    expect(handlers.e).toHaveBeenCalledTimes(1);
    expect(handlers.c).toHaveBeenCalledTimes(1);
  });
});
