import { Badge } from '@/components/ui/badge';
import type { PlanCode } from '@/lib/plans/plans';
import { cn } from '@/lib/utils/cn';

interface PlanBadgeProps {
  plan: PlanCode;
  className?: string;
}

/**
 * Small "Growth" / "Enterprise" pill rendered next to sidebar items and
 * UI gates the current plan can't reach. Visual cue that the feature
 * exists but is paywalled — clicking the item that holds this badge
 * surfaces an upgrade prompt instead of routing through.
 */
export function PlanBadge({ plan, className }: PlanBadgeProps): React.ReactElement {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 border-transparent bg-muted/60 px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground',
        className,
      )}
    >
      {plan === 'standard' ? 'Std' : plan === 'growth' ? 'Growth' : 'Enterprise'}
    </Badge>
  );
}
