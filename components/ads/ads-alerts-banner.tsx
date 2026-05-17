import { AlertCircle, AlertTriangle, ShieldAlert, Zap } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { AdsAlertListItem } from '@/lib/ads/alerts-queries';

import { AdsAlertDecisionButtons } from './ads-alert-decision-buttons';

interface AdsAlertsBannerProps {
  alerts: ReadonlyArray<AdsAlertListItem>;
  canDecide: boolean;
}

/**
 * Pending alerts banner on /ads (Phase 8 / Commit 29).
 *
 * Already sorted by `sortBySeverityThenAge` (Ajuste 3 — applied
 * inside `listAdsAlertsWithTx`). Server component renders the
 * static shell; decisions go through `<AdsAlertDecisionButtons />`
 * client-side.
 *
 * Empty state is "don't render" — the page doesn't show this
 * banner at all when no alerts are pending.
 */
export function AdsAlertsBanner({
  alerts,
  canDecide,
}: AdsAlertsBannerProps): React.ReactElement | null {
  if (alerts.length === 0) return null;

  return (
    <Card className="border-amber-500/40 bg-amber-50/40 p-4 dark:bg-amber-950/20">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <span>
          {alerts.length === 1
            ? '1 alerta pendiente'
            : `${alerts.length} alertas pendientes`}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {alerts.map((a) => (
          <AlertRow key={a.id} alert={a} canDecide={canDecide} />
        ))}
      </ul>
    </Card>
  );
}

interface AlertRowProps {
  alert: AdsAlertListItem;
  canDecide: boolean;
}

function AlertRow({ alert, canDecide }: AlertRowProps): React.ReactElement {
  const KindIcon = KIND_ICON[alert.kind];
  return (
    <li className="flex flex-col gap-2 rounded-md border bg-card/60 p-3 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-1 items-start gap-3">
        <KindIcon className="mt-0.5 h-4 w-4 text-amber-600" />
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{alert.title}</span>
            <SeverityBadge severity={alert.severity} />
            <Badge variant="outline" className="font-normal">
              {KIND_LABEL[alert.kind]}
            </Badge>
            <Badge variant="outline" className="font-normal">
              {alert.accountPlatform === 'google' ? 'Google Ads' : 'Meta Ads'}
              {alert.accountName ? ` · ${alert.accountName}` : ''}
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {alert.body}
          </p>
        </div>
      </div>
      {canDecide ? (
        <div className="flex shrink-0 items-center gap-2">
          <AdsAlertDecisionButtons alertId={alert.id} />
        </div>
      ) : null}
    </li>
  );
}

const KIND_LABEL: Record<AdsAlertListItem['kind'], string> = {
  ctr_drop: 'CTR drop',
  spend_spike: 'Spend spike',
  account_error: 'Account error',
  budget_anomaly_reserved: 'Budget anomaly',
};

const KIND_ICON: Record<
  AdsAlertListItem['kind'],
  React.ComponentType<{ className?: string }>
> = {
  ctr_drop: AlertCircle,
  spend_spike: Zap,
  account_error: ShieldAlert,
  budget_anomaly_reserved: AlertTriangle,
};

function SeverityBadge({
  severity,
}: {
  severity: AdsAlertListItem['severity'];
}): React.ReactElement {
  if (severity === 'critical') {
    return <Badge variant="destructive">Critical</Badge>;
  }
  if (severity === 'high') {
    return <Badge className="bg-amber-600 hover:bg-amber-600">High</Badge>;
  }
  if (severity === 'medium') {
    return <Badge variant="secondary">Medium</Badge>;
  }
  return <Badge variant="outline">Low</Badge>;
}
