'use client';

import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  acceptCrisisAction,
  dismissCrisisAction,
} from '@/app/(app)/reputation/crisis-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CrisisDecisionToolbarProps {
  recommendationId: string;
}

/**
 * Accept / dismiss controls for the crisis banner (Commit 25).
 * Mirrors the approvals `<DecisionToolbar />` shape — same UX
 * patterns (race-safe via Server Action, CONFLICT surfaces a
 * refresh prompt).
 */
export function CrisisDecisionToolbar({
  recommendationId,
}: CrisisDecisionToolbarProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onAccept = (): void => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('recommendationId', recommendationId);
      const result = await acceptCrisisAction(null, fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  };

  const onDismiss = (): void => {
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('recommendationId', recommendationId);
      fd.set('reason', reason.trim());
      const result = await dismissCrisisAction(null, fd);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setDismissOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        onClick={onAccept}
        disabled={pending}
        data-testid="crisis-accept"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <Check className="h-3.5 w-3.5" aria-hidden />
        )}
        Aceptar
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setDismissOpen(true)}
        disabled={pending}
        data-testid="crisis-dismiss"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
        Descartar
      </Button>
      {error ? (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" aria-hidden />
          {error}
        </span>
      ) : null}

      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar alerta de crisis</DialogTitle>
            <DialogDescription>
              Explica por qué esta señal NO es una crisis real (falso positivo
              estacional, evento aislado, dato erróneo). La razón queda en el
              audit log.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo del descarte (requerido)"
            className="min-h-[100px] w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none"
            maxLength={1000}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDismissOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              onClick={onDismiss}
              disabled={pending || reason.trim().length === 0}
            >
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
