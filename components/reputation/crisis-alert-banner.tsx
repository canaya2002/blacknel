import { AlertTriangle, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import type { CrisisIndicator } from '@/lib/reputation/queries';
import { cn } from '@/lib/utils/cn';

interface CrisisAlertBannerProps {
  crisis: CrisisIndicator;
}

/**
 * Top-of-dashboard banner that fires when `evaluateCrisis` triggers
 * (≥5 negative reviews in 72h AND ≤1 in the prior 72h — see
 * `lib/reputation/crisis-rule.ts`).
 *
 * Severity:
 *   - 'medium' (5–9 negatives)  → amber border + background.
 *   - 'high'   (10+ negatives)  → red border + background.
 *
 * The banner deep-links the first sample review id so the user can
 * jump straight to the worst case. Locations affected are surfaced as
 * a comma-separated tail (truncated to the top 3 by negative count).
 *
 * Renders nothing when `crisis.triggered === false`.
 */
export function CrisisAlertBanner({
  crisis,
}: CrisisAlertBannerProps): React.ReactElement | null {
  if (!crisis.triggered || !crisis.severity) return null;
  const tone =
    crisis.severity === 'high'
      ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
      : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  const firstReviewId = crisis.sampleReviewIds[0];
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-md border px-4 py-3 text-xs',
        tone,
      )}
      data-testid="crisis-banner"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          Crisis detectada · {crisis.recentCount} reseñas negativas en 72 h
          <Badge variant="muted" className="text-[10px] uppercase">
            {crisis.severity}
          </Badge>
        </div>
        <div className="text-[11px] opacity-80">
          Período anterior (72 h previas):{' '}
          {crisis.previousCount === 0
            ? 'sin reseñas negativas'
            : `${crisis.previousCount} negativa${crisis.previousCount === 1 ? '' : 's'}`}{' '}
          — el spike confirma una desviación, no una baseline alta.
        </div>
      </div>
      {firstReviewId ? (
        <Link
          href={`/reviews/${firstReviewId}` as `/reviews/${string}`}
          className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:underline"
        >
          Ver primera
          <ExternalLink className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}
