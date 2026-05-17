'use client';

import { Check, Loader2, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  acceptAdsAlertAction,
  dismissAdsAlertAction,
} from '@/app/(app)/ads/alerts-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AdsAlertDecisionButtonsProps {
  alertId: string;
}

export function AdsAlertDecisionButtons({
  alertId,
}: AdsAlertDecisionButtonsProps): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const [dismissOpen, setDismissOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const accept = () => {
    setError(null);
    startTransition(async () => {
      const result = await acceptAdsAlertAction(null, { alertId });
      if (!result.ok) setError(result.error.message);
    });
  };

  const dismiss = () => {
    setError(null);
    startTransition(async () => {
      const result = await dismissAdsAlertAction(null, {
        alertId,
        reason: reason.trim(),
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setDismissOpen(false);
      setReason('');
    });
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={accept}
        aria-label="Accept alert"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Aceptar
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => setDismissOpen(true)}
        aria-label="Dismiss alert"
      >
        <X className="h-3.5 w-3.5" />
        Descartar
      </Button>
      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Descartar alerta</DialogTitle>
            <DialogDescription>
              Una razón corta queda en el audit para futuras revisiones.
            </DialogDescription>
          </DialogHeader>
          <textarea
            className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: campaña pausada manualmente, sabemos del drop."
            rows={3}
          />
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDismissOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={pending || reason.trim().length === 0}
              onClick={dismiss}
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Descartando…
                </>
              ) : (
                'Descartar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
