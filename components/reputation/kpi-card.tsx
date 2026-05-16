import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { deltaTone, type DeltaResult, type DeltaTone } from '@/lib/reputation/deltas';
import { cn } from '@/lib/utils/cn';

interface KpiCardProps {
  title: string;
  /** Pre-formatted display value, e.g. "4.2 ★" or "73%". */
  value: string;
  /** Pre-formatted secondary, e.g. "47 reseñas". */
  caption?: string;
  delta: DeltaResult;
  /** Pre-formatted absolute delta value, e.g. "+0.3" or "-12%". */
  deltaLabel?: string;
  /**
   * Which direction is "good" for this KPI. Rating ↑ is good; response
   * time ↓ is good. Drives the green/red tone.
   */
  goodDirection: 'up' | 'down';
}

/**
 * KPI card with delta vs. previous window (Ajuste 3).
 *
 * The delta math (`computeDelta`) returns one of two states:
 *
 *   - `ready`: a real number with `direction: 'up' | 'down' | 'flat'`.
 *     The card renders the delta with the matching tone (green if
 *     direction matches `goodDirection`, red otherwise, gray on flat).
 *   - `na`: the prior window had < 3 reviews. Card renders the
 *     `naReason` copy in a muted tone. NO percentage is shown — a
 *     "+200%" delta from a sample of 1 is statistical theatre, not
 *     signal.
 */
export function KpiCard({
  title,
  value,
  caption,
  delta,
  deltaLabel,
  goodDirection,
}: KpiCardProps): React.ReactElement {
  const tone = deltaTone(delta, goodDirection);
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1.5">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {caption ? (
          <div className="text-[11px] text-muted-foreground">{caption}</div>
        ) : null}
        <DeltaLine delta={delta} deltaLabel={deltaLabel} tone={tone} />
      </CardContent>
    </Card>
  );
}

function DeltaLine({
  delta,
  deltaLabel,
  tone,
}: {
  delta: DeltaResult;
  deltaLabel: string | undefined;
  tone: DeltaTone;
}): React.ReactElement {
  if (delta.state === 'na') {
    return (
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Minus className="h-3 w-3" aria-hidden />
        N/A — {delta.naReason ?? 'datos insuficientes.'}
      </div>
    );
  }
  const Icon =
    delta.direction === 'up' ? ArrowUp : delta.direction === 'down' ? ArrowDown : Minus;
  const toneClass =
    tone === 'positive'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'negative'
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground';
  const label = deltaLabel ?? (delta.delta !== null ? signed(delta.delta) : '');
  return (
    <div
      className={cn('flex items-center gap-1 text-[10px] font-medium', toneClass)}
      data-testid="kpi-delta"
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label} vs período anterior
    </div>
  );
}

function signed(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${formatTrimmed(n)}` : formatTrimmed(n);
}

function formatTrimmed(n: number): string {
  // Show at most one decimal; drop trailing .0 for whole numbers.
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}
