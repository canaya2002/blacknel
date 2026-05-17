import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { AdsAlertListItem } from '@/lib/ads/alerts-queries';

interface AdsAccountAlertsHistoryProps {
  alerts: ReadonlyArray<AdsAlertListItem>;
}

/**
 * Per-account alerts history (Phase 8 / Commit 30).
 *
 * Server-rendered. Lists pending + accepted + dismissed rows
 * already sorted by `sortBySeverityThenAge` (applied inside
 * `listAdsAlertsWithTx`). Accept/dismiss controls live on the
 * top banner — this is read-only history.
 */
export function AdsAccountAlertsHistory({
  alerts,
}: AdsAccountAlertsHistoryProps): React.ReactElement {
  if (alerts.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Esta cuenta no tiene alertas registradas todavía.
      </Card>
    );
  }

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">Fecha</th>
              <th className="px-4 py-3 text-left font-medium">Tipo</th>
              <th className="px-4 py-3 text-left font-medium">Severity</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Detalle</th>
              <th className="px-4 py-3 text-left font-medium">Decidida por</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {alerts.map((a) => (
              <tr key={a.id} className="text-sm align-top">
                <td className="px-4 py-3 font-mono text-xs">
                  {a.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="font-normal">
                    {KIND_LABEL[a.kind]}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <SeverityBadge severity={a.severity} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={a.status} />
                </td>
                <td className="px-4 py-3 max-w-md text-xs text-muted-foreground">
                  <div className="font-medium text-foreground">{a.title}</div>
                  <div className="mt-1 leading-relaxed">{a.body}</div>
                  {a.decidedReason ? (
                    <div className="mt-2 text-xs italic">
                      Razón: {a.decidedReason}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-xs">
                  {a.decidedByName ?? (a.status === 'pending' ? '—' : 'Usuario')}
                  {a.decidedAt ? (
                    <div className="text-muted-foreground">
                      {a.decidedAt.toISOString().slice(0, 10)}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

const KIND_LABEL: Record<AdsAlertListItem['kind'], string> = {
  ctr_drop: 'CTR drop',
  spend_spike: 'Spend spike',
  account_error: 'Account error',
  budget_anomaly_reserved: 'Budget anomaly',
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

function StatusBadge({
  status,
}: {
  status: AdsAlertListItem['status'];
}): React.ReactElement {
  if (status === 'accepted') {
    return <Badge className="bg-green-600 hover:bg-green-600">Aceptada</Badge>;
  }
  if (status === 'dismissed') {
    return <Badge variant="secondary">Descartada</Badge>;
  }
  return <Badge variant="outline">Pendiente</Badge>;
}
