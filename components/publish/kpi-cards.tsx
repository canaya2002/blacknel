import { CheckCircle2, Clock3, FileEdit, Sparkles, Timer, XCircle } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';
import type { PostKpiCounts } from '@/lib/publish/queries';

interface KpiCardsProps {
  kpis: PostKpiCounts;
}

interface KpiSpec {
  key: keyof PostKpiCounts;
  label: string;
  Icon: typeof FileEdit;
}

const KPIS: ReadonlyArray<KpiSpec> = [
  { key: 'drafts', label: 'Borradores', Icon: FileEdit },
  { key: 'pendingApproval', label: 'En aprobación', Icon: Timer },
  { key: 'scheduled', label: 'Agendados', Icon: Clock3 },
  { key: 'published', label: 'Publicados', Icon: CheckCircle2 },
  { key: 'failed', label: 'Fallidos', Icon: XCircle },
];

/**
 * Top KPI strip. Six cards: five concrete counts derived from the
 * single GROUP BY status query (Ajuste 3), plus one placeholder
 * for engagement rate which lands in Phase 8 Reports.
 *
 * The placeholder card is intentionally muted (zinc-50 / zinc-900
 * background, zinc-400 title, gray "—" value, "Fase 8" badge). It
 * does not invent any number — leaving a "—" makes the missing data
 * obvious instead of suggesting a real value of zero.
 */
export function KpiCards({ kpis }: KpiCardsProps): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {KPIS.map((spec) => (
        <KpiCard
          key={spec.key}
          label={spec.label}
          value={kpis[spec.key]}
          Icon={spec.Icon}
        />
      ))}
      <EngagementPlaceholder />
    </div>
  );
}

function KpiCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: number;
  Icon: typeof FileEdit;
}): React.ReactElement {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <span className="text-2xl font-semibold tabular-nums tracking-tight">
        {value.toLocaleString('en-US')}
      </span>
    </Card>
  );
}

/**
 * Sixth card — visually muted. No hover state, no number, just a
 * "Fase 8" badge. The user instantly sees the slot exists but won't
 * confuse the placeholder for live data.
 */
function EngagementPlaceholder(): React.ReactElement {
  return (
    <Card
      aria-disabled
      className={cn(
        'flex cursor-default flex-col gap-2 p-4 shadow-none',
        'bg-zinc-50 dark:bg-zinc-900/50',
      )}
    >
      <div className="flex items-center justify-between text-xs font-medium text-zinc-400 dark:text-zinc-500">
        <span>Engagement rate</span>
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-300 dark:text-zinc-600">
          —
        </span>
        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            'border-zinc-200 bg-white text-zinc-400',
            'dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-500',
          )}
        >
          Fase 8
        </span>
      </div>
    </Card>
  );
}
