import { Coins, Database, Gauge, Sparkles } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import type { GenerationKpis } from '@/lib/ai/persistence';

interface AiGenerationsKpiCardsProps {
  kpis: GenerationKpis;
}

const USD_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/**
 * 4 muted KPIs for /audit/ai. Same visual shape as the /publish
 * dashboard (Commit 18) and /publish/campaigns KPIs (Commit 21).
 */
export function AiGenerationsKpiCards({
  kpis,
}: AiGenerationsKpiCardsProps): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi
        label="Costo este mes"
        value={USD_FMT.format(kpis.costCentsMonth / 100)}
        Icon={Coins}
      />
      <Kpi
        label="Generations este mes"
        value={kpis.generationsMonth.toLocaleString('en-US')}
        Icon={Sparkles}
      />
      <Kpi
        label="Cache hit rate"
        value={`${(kpis.cacheHitRate * 100).toFixed(0)}%`}
        Icon={Database}
      />
      <Kpi
        label="Modelo más usado"
        value={kpis.mostUsedModel ?? '—'}
        Icon={Gauge}
        muted={kpis.mostUsedModel === null}
      />
    </div>
  );
}

interface KpiProps {
  label: string;
  value: string;
  Icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  muted?: boolean;
}

function Kpi({ label, value, Icon, muted }: KpiProps): React.ReactElement {
  return (
    <Card className="border bg-card/30">
      <CardContent className="flex items-center gap-3 p-3">
        <Icon
          className={
            muted
              ? 'h-4 w-4 text-muted-foreground/70'
              : 'h-4 w-4 text-muted-foreground'
          }
          aria-hidden
        />
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <span
            className={
              muted
                ? 'text-base font-medium text-muted-foreground'
                : 'text-base font-semibold'
            }
          >
            {value}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
