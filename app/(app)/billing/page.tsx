import { CreditCard } from 'lucide-react';
import Link from 'next/link';

import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { requireUser } from '@/lib/auth/server';
import { PLANS } from '@/lib/plans/plans';
import { getOrgPlanCode } from '@/lib/queries/plan';

export default async function BillingPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  const planCode = await getOrgPlanCode(session);
  const plan = PLANS[planCode];
  const price = (plan.priceCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Plan actual, uso vs límites, próximo cobro y método de pago. El portal de Stripe se cablea hasta la Fase 12 — hoy los cambios de plan son inmediatos y conceptuales."
        actions={
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled>Actualizar método de pago</Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Stripe se cablea en la Fase 12; hasta entonces el plan se cambia desde aquí
                sin costo real.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        }
      />
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardDescription>Plan actual</CardDescription>
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold tracking-tight">{price}</div>
              <div className="text-xs text-muted-foreground">/ mes</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Marcas" value={formatLimit(plan.limits.brands)} />
          <Metric label="Usuarios" value={formatLimit(plan.limits.users)} />
          <Metric
            label="Cuentas sociales"
            value={formatLimit(plan.limits.socialAccounts)}
          />
          <Metric label="Ubicaciones" value={formatLimit(plan.limits.locations)} />
          <Metric
            label="Posts / mes"
            value={formatLimit(plan.limits.postsPerMonth)}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cambiar de plan</CardTitle>
          <CardDescription>
            Compara features y precios en la página de pricing pública. El upgrade real
            (con Stripe Checkout y proration) llega en la Fase 12.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm">
            <Link href="/pricing">Ver comparativa de planes</Link>
          </Button>
        </CardContent>
      </Card>
      <Card className="bg-muted/20">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CreditCard className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <CardTitle className="text-base">Facturas y pagos</CardTitle>
              <CardDescription>
                Cuando Stripe esté cableado verás historial de facturas, próximo cobro,
                método de pago y portal de gestión sin salir de Blacknel.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}

function formatLimit(value: number): string {
  return value === -1 ? 'Ilimitado' : String(value);
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-lg font-semibold tracking-tight">{value}</span>
    </div>
  );
}
