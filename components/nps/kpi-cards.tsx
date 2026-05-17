import { Card } from '@/components/ui/card';
import type { NpsAggregates } from '@/lib/nps/queries';

interface KpiCardsProps {
  aggregates: NpsAggregates;
}

/**
 * NPS analytics tile row (Phase 9 / Commit 32).
 *
 * Layout: NPS score (big number) → % promoter / passive / detractor →
 * response rate. The big NPS score is colored by range:
 *
 *   - score ≥ 50  → excellent (emerald)
 *   - 0–49        → fair (amber)
 *   - < 0         → poor (rose)
 */
export function NpsKpiCards({
  aggregates,
}: KpiCardsProps): React.ReactElement {
  const scoreColor =
    aggregates.nps >= 50
      ? 'text-emerald-700 dark:text-emerald-300'
      : aggregates.nps >= 0
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-rose-700 dark:text-rose-300';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <Card className="flex flex-col gap-1 p-4" data-testid="nps-kpi-score">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          NPS
        </span>
        <span className={`text-3xl font-semibold tabular-nums ${scoreColor}`}>
          {aggregates.nps}
        </span>
        <span className="text-xs text-muted-foreground">
          rango −100 a +100
        </span>
      </Card>

      <Card className="flex flex-col gap-1 p-4" data-testid="nps-kpi-promoters">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Promoters
        </span>
        <span className="text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
          {aggregates.promoterPct}%
        </span>
        <span className="text-xs text-muted-foreground">
          {aggregates.promoters} respuestas
        </span>
      </Card>

      <Card className="flex flex-col gap-1 p-4" data-testid="nps-kpi-passives">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Passives
        </span>
        <span className="text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
          {aggregates.passivePct}%
        </span>
        <span className="text-xs text-muted-foreground">
          {aggregates.passives} respuestas
        </span>
      </Card>

      <Card
        className="flex flex-col gap-1 p-4"
        data-testid="nps-kpi-detractors"
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Detractors
        </span>
        <span className="text-2xl font-semibold tabular-nums text-rose-700 dark:text-rose-300">
          {aggregates.detractorPct}%
        </span>
        <span className="text-xs text-muted-foreground">
          {aggregates.detractors} respuestas
        </span>
      </Card>

      <Card
        className="flex flex-col gap-1 p-4"
        data-testid="nps-kpi-response-rate"
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Response rate
        </span>
        <span className="text-2xl font-semibold tabular-nums">
          {aggregates.responseRate}%
        </span>
        <span className="text-xs text-muted-foreground">
          {aggregates.responseCount} / {aggregates.invitationCount} invites
        </span>
      </Card>
    </div>
  );
}
