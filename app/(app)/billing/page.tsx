import { CreditCard } from 'lucide-react';
import Link from 'next/link';

import { ChangePlanDialog } from '@/components/billing/change-plan-dialog';
import { StorageUsageCard } from '@/components/billing/storage-usage-card';
import { UsageCard } from '@/components/billing/usage-card';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { requireUser } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { sessionCan } from '@/lib/permissions/can';
import { PLANS } from '@/lib/plans/plans';
import { readUsage } from '@/lib/usage/counters';
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

  const [
    usersUsed,
    socialUsed,
    locationsUsed,
    brandsUsed,
    postsUsed,
    assetsUsed,
    storageUsed,
  ] = await Promise.all([
    dbAdmin(async (tx) => readUsage(tx, session.orgId, 'users')),
    dbAdmin(async (tx) => readUsage(tx, session.orgId, 'socialAccounts')),
    dbAdmin(async (tx) => readUsage(tx, session.orgId, 'locations')),
    dbAdmin(async (tx) => readUsage(tx, session.orgId, 'brands')),
    dbAdmin(async (tx) => readUsage(tx, session.orgId, 'postsPerMonth')),
    dbAdmin(async (tx) => readUsage(tx, session.orgId, 'assetsInLibrary')),
    dbAdmin(async (tx) => readUsage(tx, session.orgId, 'storageBytes')),
  ]);

  const canManageBilling = sessionCan(session, 'billing:manage');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Billing"
        description="Plan actual, uso vs límites, próximo cobro y método de pago. El portal de Stripe se cablea en la Fase 12 — hoy los cambios de plan son inmediatos y conceptuales."
        actions={
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button disabled variant="outline">
                    Customer portal
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Disponible con billing real en la Fase 12 (Stripe Customer Portal).
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
        <CardContent className="flex flex-wrap items-center gap-3">
          {canManageBilling ? (
            <ChangePlanDialog currentPlan={planCode} />
          ) : (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button disabled variant="outline">
                      Cambiar plan
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Sólo el owner puede cambiar el plan.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/pricing">Ver comparativa</Link>
          </Button>
        </CardContent>
      </Card>

      <UsageCard
        plan={planCode}
        items={[
          { metric: 'users', label: 'Usuarios', current: usersUsed },
          {
            metric: 'socialAccounts',
            label: 'Cuentas sociales conectadas',
            current: socialUsed,
          },
          { metric: 'locations', label: 'Ubicaciones', current: locationsUsed },
          { metric: 'brands', label: 'Marcas', current: brandsUsed },
          { metric: 'postsPerMonth', label: 'Posts este mes', current: postsUsed },
        ]}
      />

      <StorageUsageCard
        assetsCount={assetsUsed}
        assetsCap={plan.limits.assetsInLibrary}
        storageBytesUsed={storageUsed}
        storageBytesCap={plan.limits.storageBytes}
      />

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
                método de pago y portal de gestión sin salir de Blacknel. Hasta la
                Fase 12 los cambios de plan son inmediatos pero no generan cobro.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
