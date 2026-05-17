import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

import type { CampaignStatus } from '@/lib/campaigns/validate';

interface CampaignStatusBadgeProps {
  status: CampaignStatus;
}

const TONE: Readonly<Record<CampaignStatus, { label: string; className: string }>> = {
  draft: {
    label: 'Draft',
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  },
  active: {
    label: 'Activa',
    className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
  paused: {
    label: 'En pausa',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  },
  completed: {
    label: 'Completada',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
  },
  archived: {
    label: 'Archivada',
    className: 'bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400',
  },
};

export function CampaignStatusBadge({
  status,
}: CampaignStatusBadgeProps): React.ReactElement {
  const t = TONE[status];
  return <Badge className={cn('border-transparent', t.className)}>{t.label}</Badge>;
}
