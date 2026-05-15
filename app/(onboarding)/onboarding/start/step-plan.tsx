'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { PLAN_CODES, PLANS, type PlanCode } from '@/lib/plans/plans';
import { cn } from '@/lib/utils/cn';

import { submitPlanAction } from './actions';

export function StepPlan(): React.ReactElement {
  const [chosen, setChosen] = useState<PlanCode>('growth');
  const [state, action, pending] = useActionState<
    { error?: string } | null,
    FormData
  >(async (_prev, formData) => {
    const result = await submitPlanAction(_prev, formData);
    return result.ok ? null : { error: result.error.message };
  }, null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Elige un plan</CardTitle>
        <CardDescription>
          Puedes cambiar después desde la página de Billing. Hasta la Fase 12 los
          cambios son inmediatos y sin cobro real.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="planCode" value={chosen} />
          <RadioGroup value={chosen} onValueChange={(v) => setChosen(v as PlanCode)}>
            {PLAN_CODES.map((code) => {
              const plan = PLANS[code];
              const price = (plan.priceCents / 100).toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              });
              return (
                <Label
                  key={code}
                  htmlFor={`onb-plan-${code}`}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 transition-colors',
                    chosen === code ? 'border-primary bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <RadioGroupItem id={`onb-plan-${code}`} value={code} />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{plan.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {planSummary(plan.limits)}
                      </span>
                    </div>
                  </div>
                  <span className="font-mono text-sm font-semibold">{price}/mes</span>
                </Label>
              );
            })}
          </RadioGroup>
          {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? 'Aplicando…' : 'Continuar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function planSummary(limits: { brands: number; users: number; postsPerMonth: number }): string {
  const brand = limits.brands === -1 ? 'marcas ∞' : `${limits.brands} marca${limits.brands !== 1 ? 's' : ''}`;
  const users = limits.users === -1 ? 'usuarios ∞' : `${limits.users} usuarios`;
  const posts = limits.postsPerMonth === -1 ? 'posts ∞' : `${limits.postsPerMonth} posts/mes`;
  return `${brand} · ${users} · ${posts}`;
}
