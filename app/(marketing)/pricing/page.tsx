import { Check, X } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLAN_CODES, PLANS } from '@/lib/plans/plans';
import { cn } from '@/lib/utils/cn';

export default function PricingPage(): React.ReactElement {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Pricing
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Tres planes claros. Sin add-ons confusos, sin descuentos temporales. Lo que
          ves es lo que pagas.
        </p>
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {PLAN_CODES.map((code) => {
          const plan = PLANS[code];
          const price = (plan.priceCents / 100).toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
            maximumFractionDigits: 0,
          });
          const highlighted = code === 'growth';
          return (
            <Card
              key={code}
              className={cn(
                'flex flex-col',
                highlighted && 'border-primary shadow-md',
              )}
            >
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {highlighted ? (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                      Recomendado
                    </span>
                  ) : null}
                </div>
                <CardDescription>
                  <span className="text-3xl font-semibold text-foreground">{price}</span>{' '}
                  <span className="text-xs text-muted-foreground">/mes</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <ul className="flex flex-col gap-2 text-sm">
                  <Feature label={`${formatLimit(plan.limits.brands)} marcas`} included />
                  <Feature label={`${formatLimit(plan.limits.users)} usuarios`} included />
                  <Feature
                    label={`${formatLimit(plan.limits.socialAccounts)} cuentas sociales`}
                    included
                  />
                  <Feature
                    label={`${formatLimit(plan.limits.locations)} ubicaciones`}
                    included
                  />
                  <Feature
                    label={`${formatLimit(plan.limits.postsPerMonth)} posts / mes`}
                    included
                  />
                  <Feature
                    label="Aprobaciones"
                    included={plan.features.approvals}
                  />
                  <Feature
                    label="Social listening"
                    included={Boolean(plan.features.listening)}
                  />
                  <Feature
                    label="Competitor tracking"
                    included={Boolean(plan.features.competitors)}
                  />
                  <Feature
                    label="Ads intelligence"
                    included={plan.features.ads}
                  />
                  <Feature
                    label="Report builder"
                    included={plan.features.reportBuilder}
                  />
                </ul>
                <Button asChild className="mt-auto" variant={highlighted ? 'default' : 'outline'}>
                  <Link href="/login">Probar gratis</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function formatLimit(value: number): string {
  return value === -1 ? 'Ilimitadas' : String(value);
}

function Feature({
  label,
  included,
}: {
  label: string;
  included: boolean;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-2">
      {included ? (
        <Check className="h-4 w-4 text-emerald-500" aria-hidden />
      ) : (
        <X className="h-4 w-4 text-muted-foreground/60" aria-hidden />
      )}
      <span className={cn('flex-1', !included && 'text-muted-foreground')}>{label}</span>
    </li>
  );
}
