import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import type { DeltaShape, DeltaTrend } from '@/lib/reports/period';
import { cn } from '@/lib/utils/cn';

interface ReportKpiCardProps {
  label: string;
  /** Formatted current value (string — caller handles formatting). */
  value: string;
  delta: DeltaShape;
  /**
   * For metrics where lower is better (response time, failures),
   * we invert the trend tone so `down` is green.
   */
  goodDirection?: 'up' | 'down';
  /** Format the delta value into something human-readable. */
  formatDelta?: (delta: number) => string;
  /** Format the previous value for the "vs X" tag. */
  formatPrevious?: (previous: number) => string;
  /** Optional caption shown below the value. */
  caption?: string;
}

/**
 * KPI card with benchmark comparison (Phase 8 / Commit 27, Ajuste 1).
 *
 * Three lines:
 *
 *   1. UPPERCASE label (muted).
 *   2. Current value (prominent).
 *   3. Trend arrow + signed delta + "vs <previous>" caption.
 *
 * The trend tone branches on `trend` + `goodDirection`:
 *
 *   trend / goodDirection      tone
 *   -----------------------    ----
 *   up    + up   (e.g. rating)  green
 *   down  + up                  red
 *   up    + down (e.g. failures) red
 *   down  + down                green
 *   flat (always)               zinc
 *
 * **Why threshold 5%.** Below ±5% the eye / brain treats it as
 * noise; calling it `up` would falsely cue progress. The flat
 * tone tells the manager "stable" without distraction.
 */
export function ReportKpiCard({
  label,
  value,
  delta,
  goodDirection = 'up',
  formatDelta,
  formatPrevious,
  caption,
}: ReportKpiCardProps): React.ReactElement {
  const tone = toneFor(delta.trend, goodDirection);
  return (
    <Card className="border bg-card/30">
      <CardContent className="flex flex-col gap-1.5 p-4">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-xl font-semibold">{value}</span>
        {delta.delta !== null && delta.previous !== null ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-[11px]',
              tone.text,
            )}
          >
            {tone.icon}
            {formatDelta ? formatDelta(delta.delta) : signed(delta.delta)}
            {delta.previous !== null ? (
              <span className="text-muted-foreground">
                vs{' '}
                {formatPrevious
                  ? formatPrevious(delta.previous)
                  : String(Math.round(delta.previous * 100) / 100)}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Sin baseline</span>
        )}
        {caption ? (
          <span className="text-[11px] text-muted-foreground">{caption}</span>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface Tone {
  text: string;
  icon: React.ReactElement;
}

function toneFor(
  trend: DeltaTrend,
  goodDirection: 'up' | 'down',
): Tone {
  if (trend === 'flat') {
    return {
      text: 'text-muted-foreground',
      icon: <ArrowRight className="h-3 w-3" aria-hidden />,
    };
  }
  const isGood =
    (trend === 'up' && goodDirection === 'up') ||
    (trend === 'down' && goodDirection === 'down');
  return {
    text: isGood
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400',
    icon:
      trend === 'up' ? (
        <ArrowUp className="h-3 w-3" aria-hidden />
      ) : (
        <ArrowDown className="h-3 w-3" aria-hidden />
      ),
  };
}

function signed(n: number): string {
  if (n > 0) return `+${Math.round(n * 100) / 100}`;
  return String(Math.round(n * 100) / 100);
}
