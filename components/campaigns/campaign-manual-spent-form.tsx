'use client';

import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { updateManualSpentAction } from '@/app/(app)/publish/campaigns/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CampaignManualSpentFormProps {
  campaignId: string;
  currentManualSpentCents: number | null;
  budgetCents: number | null;
}

/**
 * Manual "spent" entry. Phase-8 placeholder until real ad-spend
 * data is wired in. Writes to `campaigns.metadata.manualSpentCents`
 * via `updateManualSpentAction`. Validates against `budgetCents`
 * client-side (form rejects spent > budget with a hint, but the
 * server doesn't enforce that — over-budget is a real
 * operational state once Phase 8 lands).
 */
export function CampaignManualSpentForm({
  campaignId,
  currentManualSpentCents,
  budgetCents,
}: CampaignManualSpentFormProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [value, setValue] = useState<string>(
    currentManualSpentCents !== null ? String(currentManualSpentCents / 100) : '',
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    const cents = Math.round(Number(value.trim()) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Monto inválido.');
      return;
    }
    startTransition(async () => {
      const result = await updateManualSpentAction(null, {
        campaignId,
        manualSpentCents: cents,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setFeedback('Actualizado.');
      router.refresh();
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex max-w-2xl flex-col gap-2 rounded-lg border bg-card/30 p-4"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="manual-spent">Spent manual (MXN)</Label>
        <p className="text-[11px] text-muted-foreground">
          Captura manual hasta que el connector de Ads esté disponible (Fase
          8). El total se compara contra el budget para mostrar % consumido en
          el resumen.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id="manual-spent"
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          className="max-w-xs"
        />
        <Button type="submit" disabled={pending} size="sm">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Save className="h-3.5 w-3.5" aria-hidden />
          )}
          Guardar
        </Button>
      </div>
      {budgetCents !== null ? (
        <p className="text-[11px] text-muted-foreground">
          Budget definido: {fmtCents(budgetCents)}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {feedback ? (
        <p className="text-xs text-emerald-600" role="status">
          {feedback}
        </p>
      ) : null}
    </form>
  );
}

function fmtCents(c: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
  }).format(c / 100);
}
