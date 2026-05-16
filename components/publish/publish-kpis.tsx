import { Card } from '@/components/ui/card';
import type { PostKpiCounts } from '@/lib/publish/queries';
import { cn } from '@/lib/utils/cn';

interface PublishKpisProps {
  kpis: PostKpiCounts;
}

interface KpiSpec {
  label: string;
  value: number;
  /** Hex/Tailwind accent ring on the left of the card. */
  accent:
    | 'zinc'
    | 'amber'
    | 'blue'
    | 'emerald'
    | 'red';
}

const ACCENT_RING: Record<KpiSpec['accent'], string> = {
  zinc: 'before:bg-zinc-400/60',
  amber: 'before:bg-amber-500',
  blue: 'before:bg-blue-500',
  emerald: 'before:bg-emerald-500',
  red: 'before:bg-red-500',
};

/**
 * KPI cards row for /publish (Ajuste 3). All numbers come from
 * `loadPublishDashboardData` — never a separate fetch.
 *
 * The engagement card is a deliberate Phase-8 placeholder. We
 * render it grey + neutral copy rather than inventing a number,
 * which is the rule the user spelled out in Ajuste 3.
 */
export function PublishKpis({
  kpis,
}: PublishKpisProps): React.ReactElement {
  const items: ReadonlyArray<KpiSpec> = [
    { label: 'Borradores', value: kpis.drafts, accent: 'zinc' },
    { label: 'En aprobación', value: kpis.pendingApproval, accent: 'amber' },
    { label: 'Agendados', value: kpis.scheduled + kpis.publishing, accent: 'blue' },
    { label: 'Publicados', value: kpis.published, accent: 'emerald' },
    { label: 'Fallidos', value: kpis.failed, accent: 'red' },
  ];

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      data-testid="publish-kpis"
    >
      {items.map((it) => (
        <KpiCard key={it.label} spec={it} />
      ))}
      <EngagementPlaceholder />
    </div>
  );
}

function KpiCard({ spec }: { spec: KpiSpec }): React.ReactElement {
  return (
    <Card
      className={cn(
        'relative overflow-hidden px-4 py-3',
        // Left accent ribbon via ::before. Uses 3px width.
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        ACCENT_RING[spec.accent],
      )}
      data-testid={`publish-kpi-${spec.accent}`}
    >
      <div className="text-xs font-medium text-muted-foreground">
        {spec.label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {spec.value}
      </div>
    </Card>
  );
}

function EngagementPlaceholder(): React.ReactElement {
  return (
    <Card
      className="relative overflow-hidden border-dashed px-4 py-3"
      data-testid="publish-kpi-engagement-placeholder"
    >
      <div className="text-xs font-medium text-muted-foreground">
        Engagement rate
      </div>
      <div className="mt-1 text-sm leading-tight text-muted-foreground">
        Disponible en Reports (Fase 8)
      </div>
    </Card>
  );
}
