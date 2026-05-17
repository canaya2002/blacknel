import { cn } from '@/lib/utils/cn';
import type { NpsResponseCategory } from '@/lib/db/schema';

interface CategoryBadgeProps {
  category: NpsResponseCategory;
  className?: string;
}

const COPY: Record<NpsResponseCategory, { label: string; cls: string }> = {
  promoter: {
    label: 'Promoter',
    cls:
      'border-emerald-500/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  passive: {
    label: 'Passive',
    cls:
      'border-amber-500/40 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  detractor: {
    label: 'Detractor',
    cls:
      'border-rose-500/40 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  },
};

export function CategoryBadge({
  category,
  className,
}: CategoryBadgeProps): React.ReactElement {
  const { label, cls } = COPY[category];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        cls,
        className,
      )}
      data-testid={`nps-category-${category}`}
    >
      {label}
    </span>
  );
}
