import { Clock, DollarSign, MousePointerClick, Wifi } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import type { AdsOverview } from '@/lib/ads/queries';
import { cn } from '@/lib/utils/cn';

interface AdsOverviewCardsProps {
  overview: AdsOverview;
}

/**
 * Four read-only KPI cards above the accounts table. All values
 * reflect the last 30 days of `ads_spend_daily` per `getAdsOverviewWithTx`.
 * No deltas (the /reports page handles period comparisons) —
 * these are at-a-glance counts for the /ads landing only.
 */
export function AdsOverviewCards({
  overview,
}: AdsOverviewCardsProps): React.ReactElement {
  const ctr =
    overview.impressions30d > 0
      ? overview.clicks30d / overview.impressions30d
      : 0;
  const spendUsd = (overview.spendUsdCents30d / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={Wifi}
        label="Cuentas conectadas"
        value={String(overview.accountsConnected)}
      />
      <KpiCard icon={DollarSign} label="Spend 30d (USD)" value={spendUsd} />
      <KpiCard
        icon={MousePointerClick}
        label="CTR 30d"
        value={`${(ctr * 100).toFixed(2)}%`}
        hint={`${overview.clicks30d.toLocaleString('en-US')} clicks / ${overview.impressions30d.toLocaleString('en-US')} impressions`}
      />
      <KpiCard
        icon={Clock}
        label="Última sincronización"
        value={
          overview.lastSyncAt
            ? formatRelative(overview.lastSyncAt)
            : 'Nunca'
        }
        hint={
          overview.lastSyncAt
            ? overview.lastSyncAt.toISOString().replace('T', ' ').slice(0, 16)
            : 'El cron corre cada 24 h en dev'
        }
      />
    </div>
  );
}

interface KpiCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
}: KpiCardProps): React.ReactElement {
  return (
    <Card className={cn('overflow-hidden')}>
      <CardContent className="flex flex-col gap-1.5 pt-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint ? (
          <div className="text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'hace instantes';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  return `hace ${days} d`;
}
