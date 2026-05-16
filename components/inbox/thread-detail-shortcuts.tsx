'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import {
  closeThreadAction,
  escalateThreadAction,
} from '@/app/(app)/inbox/actions';
import { fireToast } from '@/components/common/toast';
import { useKeyboardShortcuts } from '@/components/common/keyboard-shortcuts';

interface ThreadDetailShortcutsProps {
  threadId: string;
}

/**
 * Keyboard bindings for the thread-detail page.
 *
 *   j / k → scroll between message bubbles in the timeline.
 *   r     → focus the composer textarea.
 *   e     → escalate the thread (priority=urgent + audit).
 *   c     → close the thread (status=closed + audit).
 *   a     → toast "use the action menu" until Phase-9 assign UI lands.
 *
 * All shortcuts respect the editable-target guard in
 * `useKeyboardShortcuts` — typing in the composer never triggers them.
 */
export function ThreadDetailShortcuts({
  threadId,
}: ThreadDetailShortcutsProps): null {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const runFormAction = (
    action: typeof closeThreadAction | typeof escalateThreadAction,
    successLabel: string,
  ): void => {
    if (pending) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set('threadId', threadId);
      const result = await action(null, fd);
      if (result.ok) {
        fireToast({ message: successLabel, tone: 'success' });
        router.refresh();
      } else {
        fireToast({ message: result.error.message, tone: 'error' });
      }
    });
  };

  useKeyboardShortcuts({
    handlers: {
      j: () => scrollMessage('next'),
      k: () => scrollMessage('prev'),
      r: () => {
        const ta = document.querySelector<HTMLTextAreaElement>(
          '[data-testid="composer-textarea"]',
        );
        ta?.focus();
      },
      e: () => runFormAction(escalateThreadAction, 'Thread escalado.'),
      c: () => runFormAction(closeThreadAction, 'Thread cerrado.'),
      a: () =>
        fireToast({
          message:
            'Asignación rápida llega con la UI de equipo en Fase 9. Por ahora usa el menú de acciones.',
          tone: 'info',
        }),
    },
  });

  return null;
}

function scrollMessage(direction: 'next' | 'prev'): void {
  if (typeof document === 'undefined') return;
  const bubbles = document.querySelectorAll<HTMLElement>('[data-message-bubble]');
  if (bubbles.length === 0) return;
  // Find the bubble nearest the viewport center, then move from there.
  const viewportMiddle = window.innerHeight / 2;
  let bestIdx = 0;
  let bestDist = Infinity;
  bubbles.forEach((el, i) => {
    const rect = el.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const dist = Math.abs(center - viewportMiddle);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  });
  const targetIdx =
    direction === 'next'
      ? Math.min(bestIdx + 1, bubbles.length - 1)
      : Math.max(bestIdx - 1, 0);
  bubbles[targetIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
