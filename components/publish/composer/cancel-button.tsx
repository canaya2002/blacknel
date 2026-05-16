'use client';

import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';

interface CancelButtonProps {
  dirty: boolean;
}

/**
 * Cancel CTA for the composer.
 *
 * 19a behavior:
 *   - Clean state → navigates back to `/publish` without prompt.
 *   - Dirty state → fires a single confirm() prompt and navigates
 *     on accept.
 *
 * Full `beforeunload` + dirty-state nav guard + auto-save flow
 * lands in Commit 21 (TODO composer-dirty-state-guard). The
 * `confirm()` here is the minimum viable protection so the
 * 19a skeleton doesn't quietly drop the user's work.
 */
export function CancelButton({ dirty }: CancelButtonProps): React.ReactElement {
  const router = useRouter();

  const onClick = (): void => {
    if (dirty) {
      const ok = window.confirm(
        'Hay cambios sin guardar. ¿Salir del editor de todos modos?',
      );
      if (!ok) return;
    }
    router.push('/publish');
  };

  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <X className="h-4 w-4" aria-hidden />
      Cancelar
    </Button>
  );
}
