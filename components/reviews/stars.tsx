import { Star } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

interface StarsProps {
  /** Integer 1..5. Half-stars are intentionally not supported (Ajuste 2). */
  rating: number;
  /** `row` = 16px (size-4) in lists; `detail` = 20px (size-5) on the review page. */
  size?: 'row' | 'detail';
  className?: string;
}

/**
 * Inline rating display using Lucide's `Star` with `fill-current`. The
 * filled stars carry an amber tone; the empty stars stay neutral
 * (zinc-300 / dark:zinc-700) so the contrast is visible but the row
 * doesn't shout (Ajuste 2). Integer ratings only — no half-stars.
 *
 * Accessibility: the container exposes `aria-label="X de 5 estrellas"`
 * and the per-star icons are `aria-hidden`. Screen readers therefore
 * announce one number, not five "star" elements.
 */
export function Stars({ rating, size = 'row', className }: StarsProps): React.ReactElement {
  // Clamp defensively so a corrupted row doesn't render 17 stars.
  const safe = Math.max(0, Math.min(5, Math.round(rating)));
  const dim = size === 'detail' ? 'h-5 w-5' : 'h-4 w-4';

  return (
    <span
      role="img"
      aria-label={`${safe} de 5 estrellas`}
      className={cn('inline-flex items-center gap-0.5', className)}
    >
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= safe;
        return (
          <Star
            key={i}
            aria-hidden
            className={cn(
              dim,
              'fill-current',
              filled
                ? 'text-amber-500'
                : 'text-zinc-300 dark:text-zinc-700',
            )}
          />
        );
      })}
    </span>
  );
}
