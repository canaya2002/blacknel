'use client';

import { Loader2, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  createCampaignAction,
  updateCampaignAction,
} from '@/app/(app)/publish/campaigns/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CAMPAIGN_GOALS, type CampaignGoal } from '@/lib/campaigns/validate';
import type { BrandOption } from '@/lib/publish/picker-data';

interface InitialCampaign {
  campaignId: string;
  name: string;
  goal: CampaignGoal;
  brandId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  budgetCents: number | null;
}

interface CampaignFormProps {
  mode: 'create' | 'edit';
  brandOptions: ReadonlyArray<BrandOption>;
  initial?: InitialCampaign;
}

const GOAL_LABEL: Readonly<Record<CampaignGoal, string>> = {
  awareness: 'Awareness',
  engagement: 'Engagement',
  leads: 'Leads',
  reviews: 'Reseñas',
  reputation: 'Reputación',
  event: 'Evento',
  launch: 'Lanzamiento',
  promotion: 'Promoción',
  education: 'Educación',
  crisis: 'Crisis',
  seasonal: 'Estacional',
  evergreen: 'Evergreen',
};
const NONE = '__none__';

/**
 * Create-or-edit form. Same component for both modes — `mode`
 * decides which Server Action fires + whether we show the
 * "starts/ends in the future" hint. Validation surfaces both
 * Zod-level errors (returned by the action's `Result<>`) and
 * cross-field errors (`startsAt >= endsAt`) under the offending
 * input.
 */
export function CampaignForm({
  mode,
  brandOptions,
  initial,
}: CampaignFormProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial?.name ?? '');
  const [goal, setGoal] = useState<CampaignGoal>(initial?.goal ?? 'evergreen');
  const [brandId, setBrandId] = useState<string>(initial?.brandId ?? NONE);
  const [startsAt, setStartsAt] = useState<string>(toLocalDate(initial?.startsAt));
  const [endsAt, setEndsAt] = useState<string>(toLocalDate(initial?.endsAt));
  const [budget, setBudget] = useState<string>(
    initial?.budgetCents !== null && initial?.budgetCents !== undefined
      ? String(initial.budgetCents / 100)
      : '',
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError(null);
    const startsAtDate = startsAt ? new Date(startsAt) : null;
    const endsAtDate = endsAt ? new Date(endsAt) : null;
    const budgetCents =
      budget.trim().length === 0
        ? null
        : Math.round(Number(budget.trim()) * 100);

    if (budgetCents !== null && (!Number.isFinite(budgetCents) || budgetCents < 0)) {
      setError('Budget inválido.');
      return;
    }

    startTransition(async () => {
      if (mode === 'create') {
        const result = await createCampaignAction(null, {
          name: name.trim(),
          brandId: brandId === NONE ? null : brandId,
          goal,
          startsAt: startsAtDate,
          endsAt: endsAtDate,
          budgetCents,
        });
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        router.push(`/publish/campaigns/${result.data.campaignId}`);
      } else {
        if (!initial) return;
        const result = await updateCampaignAction(null, {
          campaignId: initial.campaignId,
          name: name.trim(),
          brandId: brandId === NONE ? null : brandId,
          goal,
          startsAt: startsAtDate,
          endsAt: endsAtDate,
          budgetCents,
        });
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        router.refresh();
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid max-w-2xl grid-cols-1 gap-4 rounded-lg border bg-card/30 p-4 md:grid-cols-2"
    >
      <div className="flex flex-col gap-1 md:col-span-2">
        <Label htmlFor="campaign-name">Nombre</Label>
        <Input
          id="campaign-name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
          maxLength={120}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="campaign-goal">Goal</Label>
        <Select
          value={goal}
          onValueChange={(v) => setGoal(v as CampaignGoal)}
        >
          <SelectTrigger id="campaign-goal">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CAMPAIGN_GOALS.map((g) => (
              <SelectItem key={g} value={g}>
                {GOAL_LABEL[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="campaign-brand">Brand</Label>
        <Select value={brandId} onValueChange={setBrandId}>
          <SelectTrigger id="campaign-brand">
            <SelectValue placeholder="Sin marca específica" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Sin marca específica</SelectItem>
            {brandOptions.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="campaign-starts">Inicio</Label>
        <Input
          id="campaign-starts"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="campaign-ends">Fin</Label>
        <Input
          id="campaign-ends"
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.currentTarget.value)}
        />
      </div>

      <div className="flex flex-col gap-1 md:col-span-2">
        <Label htmlFor="campaign-budget">Budget (MXN, opcional)</Label>
        <Input
          id="campaign-budget"
          type="number"
          min="0"
          step="0.01"
          value={budget}
          onChange={(e) => setBudget(e.currentTarget.value)}
          placeholder="ej. 5000"
        />
      </div>

      {error ? (
        <p className="text-xs text-destructive md:col-span-2" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2 md:col-span-2">
        <Button type="submit" disabled={pending || name.trim().length === 0}>
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Save className="h-4 w-4" aria-hidden />
          )}
          {mode === 'create' ? 'Crear campaña' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}

function toLocalDate(d: Date | null | undefined): string {
  if (!d) return '';
  // datetime-local expects `YYYY-MM-DDTHH:mm`.
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
