import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { LimitMetric, PlanCode } from '@/lib/plans/plans';
import { PLANS } from '@/lib/plans/plans';
import { cn } from '@/lib/utils/cn';

interface UsageItem {
  metric: LimitMetric;
  label: string;
  current: number;
}

interface UsageCardProps {
  plan: PlanCode;
  items: ReadonlyArray<UsageItem>;
}

export function UsageCard({ plan, items }: UsageCardProps): React.ReactElement {
  const planDef = PLANS[plan];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Uso del plan</CardTitle>
        <CardDescription>
          Los contadores se actualizan en tiempo real. Llegar al tope dispara un
          aviso de upgrade en las acciones afectadas; el plan no se sube solo.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => {
          const cap = planDef.limits[item.metric];
          const isUnlimited = cap === -1;
          const ratio = isUnlimited ? 0 : Math.min(100, (item.current / Math.max(1, cap)) * 100);
          const reached = !isUnlimited && item.current >= cap;
          const near = !isUnlimited && !reached && ratio >= 80;
          return (
            <div
              key={item.metric}
              className="flex flex-col gap-2 rounded-md border bg-card/30 p-3"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {item.label}
                </span>
                <span
                  className={cn(
                    'font-mono text-sm font-semibold',
                    reached && 'text-destructive',
                    near && 'text-amber-600',
                  )}
                >
                  {item.current} / {isUnlimited ? '∞' : cap}
                </span>
              </div>
              {!isUnlimited ? (
                <Progress
                  value={ratio}
                  className={cn(
                    'h-1.5',
                    reached && '[&>div]:bg-destructive',
                    near && !reached && '[&>div]:bg-amber-500',
                  )}
                />
              ) : (
                <Progress value={20} className="h-1.5 opacity-30" />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
