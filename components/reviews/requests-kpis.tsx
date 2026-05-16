import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RequestKpis } from '@/lib/reviews/request-queries';

interface RequestsKpisProps {
  kpis: RequestKpis;
}

/**
 * Top-of-page KPI strip for /reviews/requests. The five buckets the
 * spec calls out (sent / opened / completed / positive routed /
 * negative captured) plus the derived completion rate.
 *
 * Each cell is a `<Card>` so they line up with the rest of the
 * dashboard layout. No deltas here — the bucketization is the
 * status, not a time-series. KPIs with deltas live on /reputation.
 */
export function RequestsKpis({ kpis }: RequestsKpisProps): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Cell label="Enviadas" value={kpis.sent} />
      <Cell label="Abiertas" value={kpis.opened} />
      <Cell label="Completadas" value={kpis.completed} />
      <Cell label="Positivas" value={kpis.positiveRouted} tone="positive" />
      <Cell label="Capturadas" value={kpis.negativeCaptured} tone="negative" />
      <Cell
        label="Tasa de respuesta"
        value={
          kpis.completionRate === null
            ? '—'
            : `${Math.round(kpis.completionRate)}%`
        }
      />
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'positive' | 'negative';
}): React.ReactElement {
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'negative'
        ? 'text-red-600 dark:text-red-400'
        : 'text-foreground';
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-xl font-semibold tabular-nums ${toneClass}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
