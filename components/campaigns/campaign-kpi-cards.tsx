import { Archive, CalendarCheck, FlaskConical, PauseCircle, Wallet } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import type { CampaignKpiCounts } from '@/lib/campaigns/queries';

interface CampaignKpiCardsProps {
  counts: CampaignKpiCounts;
}

const NUMBER_FMT = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * 5 muted KPIs across the top of /publish/campaigns. Same visual
 * shape as the /publish dashboard KPIs (Commit 18) — single line,
 * `border` + `bg-card/30`, label in uppercase muted, value
 * prominent. Total budget is the only `currency` formatted card.
 */
export function CampaignKpiCards({
  counts,
}: CampaignKpiCardsProps): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi label="Activas" value={String(counts.active)} Icon={CalendarCheck} />
      <Kpi label="Drafts" value={String(counts.draft)} Icon={FlaskConical} />
      <Kpi label="En pausa" value={String(counts.paused)} Icon={PauseCircle} />
      <Kpi label="Archivadas" value={String(counts.archived)} Icon={Archive} muted />
      <Kpi
        label="Budget total"
        value={NUMBER_FMT.format(counts.totalBudgetCents / 100)}
        Icon={Wallet}
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
