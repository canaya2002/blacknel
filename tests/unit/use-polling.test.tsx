import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePolling } from '../../components/common/use-polling';

/**
 * Behavioural contract of `usePolling`. We mount the hook with
 * React 19 + createRoot directly to avoid pulling in a new dev dep
 * just for `renderHook`.
 *
 * Locked-in properties:
 *
 *   - Fires `refresh()` every `intervalMs` while document is visible.
 *   - Pauses entirely when visibility flips to 'hidden'.
 *   - Fires `refresh()` once immediately when visibility returns,
 *     then resumes the cadence.
 *   - Debounces to one fire per second across the hook's lifetime so
 *     fast tab-switching can't produce a request storm.
 *   - Honors `enabled=false` as a hard off-switch.
 */

function Harness({
  refresh,
  intervalMs,
  enabled,
}: {
  refresh: () => void;
  intervalMs: number;
  enabled?: boolean;
}): null {
  usePolling(refresh, {
    intervalMs,
    ...(enabled !== undefined ? { enabled } : {}),
  });
  return null;
}

let container: HTMLDivElement;
let root: Root;

function mount(element: React.ReactElement): void {
  act(() => {
    root.render(element);
  });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('fires refresh on each interval while visible', () => {
    const refresh = vi.fn();
    mount(<Harness refresh={refresh} intervalMs={5000} />);

    expect(refresh).toHaveBeenCalledTimes(0);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('pauses when hidden, resumes with one immediate fire when visible', () => {
    const refresh = vi.fn();
    mount(<Harness refresh={refresh} intervalMs={5000} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Past the 1s debounce window, then return visible — one immediate
    // refresh + resumed cadence.
    act(() => {
      vi.setSystemTime(Date.now() + 1500);
    });
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('debounces to at most one fire per second across rapid tab transitions', () => {
    const refresh = vi.fn();
    mount(<Harness refresh={refresh} intervalMs={5000} />);

    for (let i = 0; i < 5; i++) {
      setVisibility('hidden');
      setVisibility('visible');
    }
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      vi.setSystemTime(Date.now() + 1100);
    });
    setVisibility('hidden');
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does nothing when enabled=false', () => {
    const refresh = vi.fn();
    mount(<Harness refresh={refresh} intervalMs={1000} enabled={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
