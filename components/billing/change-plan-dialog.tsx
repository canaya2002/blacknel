'use client';

import { Check } from 'lucide-react';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { PLAN_CODES, PLANS, type PlanCode } from '@/lib/plans/plans';
import { cn } from '@/lib/utils/cn';

import {
  changePlanAction,
  type PlanChangeBlockedReason,
} from '../../app/(app)/billing/actions';

function fmtLimit(value: number): string {
  return value === -1 ? 'Ilimitados' : String(value);
}

interface ChangePlanDialogProps {
  currentPlan: PlanCode;
}

export function ChangePlanDialog({
  currentPlan,
}: ChangePlanDialogProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<PlanCode>(currentPlan);

  const [state, action, pending] = useActionState<
    | { ok: true; planCode: PlanCode }
    | { ok: false; message: string; blockers?: PlanChangeBlockedReason[] }
    | null,
    FormData
  >(async (_prev, formData) => {
    const result = await changePlanAction(_prev, formData);
    if (result.ok) {
      setOpen(false);
      return { ok: true, planCode: result.data.planCode };
    }
    return { ok: false, message: result.error.message, blockers: result.error.blockers };
  }, null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)} variant="outline">
        Cambiar plan
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar plan</DialogTitle>
          <DialogDescription>
            El cambio aplica inmediatamente. Bajar de plan puede bloquear el cambio si
            tu uso actual excede los nuevos límites. Stripe entra en la Fase 12 —
            por ahora la mutación es directa, sin cobro.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="planCode" value={chosen} />
          <RadioGroup
            value={chosen}
            onValueChange={(v) => setChosen(v as PlanCode)}
            className="gap-2"
          >
            {PLAN_CODES.map((code) => {
              const plan = PLANS[code];
              const price = (plan.priceCents / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              });
              const isCurrent = code === currentPlan;
              return (
                <Label
                  key={code}
                  htmlFor={`plan-${code}`}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3',
                    chosen === code ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <RadioGroupItem id={`plan-${code}`} value={code} />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{plan.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {fmtLimit(plan.limits.users)} usuarios ·{' '}
                        {fmtLimit(plan.limits.socialAccounts)} cuentas sociales
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{price}</span>
                    {isCurrent ? (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-600">
                        Actual
                      </span>
                    ) : null}
                    <Check
                      className={cn(
                        'h-4 w-4',
                        chosen === code ? 'text-primary' : 'opacity-0',
                      )}
                      aria-hidden
                    />
                  </div>
                </Label>
              );
            })}
          </RadioGroup>
          {state && !state.ok ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs">
              <p className="font-medium text-destructive">{state.message}</p>
              {state.blockers && state.blockers.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-destructive">
                  {state.blockers.map((b) => (
                    <li key={b.metric}>
                      {b.metric}: {b.current} en uso, el plan permite {b.newCap}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || chosen === currentPlan}>
              {pending ? 'Aplicando…' : 'Cambiar a ' + PLANS[chosen].name}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
