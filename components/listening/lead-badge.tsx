import { Star } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

interface LeadBadgeProps {
  className?: string;
}

export function LeadBadge({ className }: LeadBadgeProps): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
        className,
      )}
      data-testid="listening-lead-badge"
    >
      <Star className="h-3 w-3" aria-hidden />
      Lead
    </span>
  );
}
