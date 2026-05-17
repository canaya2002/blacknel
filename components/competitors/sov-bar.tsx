import { cn } from '@/lib/utils/cn';

interface SovBarProps {
  /** Share of voice ∈ [0, 1]. */
  sov: number;
  className?: string;
}

/**
 * Inline share-of-voice bar. Visual: competitor portion left,
 * your-brand portion right. 0.5 = parity (visually balanced).
 *
 * Color band:
 *   - sov > 0.6 → red (competitor dominates)
 *   - 0.4..0.6  → amber (parity-ish)
 *   - < 0.4     → emerald (you dominate)
 */
export function SovBar({ sov, className }: SovBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(1, sov));
  const pct = clamped * 100;
  const tone =
    sov >= 0.6
      ? 'bg-rose-500'
      : sov >= 0.4
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs',
        className,
      )}
      data-testid="competitor-sov-bar"
    >
      <div className="relative h-2 w-32 overflow-hidden rounded bg-muted">
        <div
          className={cn('absolute inset-y-0 left-0', tone)}
          style={{ width: `${pct.toFixed(1)}%` }}
        />
      </div>
      <span className="tabular-nums text-muted-foreground">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
