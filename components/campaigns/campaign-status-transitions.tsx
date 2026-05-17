'use client';

import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { transitionCampaignStatusAction } from '@/app/(app)/publish/campaigns/actions';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CampaignStatus } from '@/lib/campaigns/validate';

interface CampaignStatusTransitionsProps {
  campaignId: string;
  allowedTransitions: ReadonlyArray<CampaignStatus>;
}

const LABEL: Readonly<Record<CampaignStatus, string>> = {
  draft: 'Pasar a draft',
  active: 'Activar',
  paused: 'Pausar',
  completed: 'Marcar completada',
  archived: 'Archivar',
};

/**
 * Dropdown that surfaces only the allowed next states for the
 * campaign's current status (driven by
 * `allowedCampaignTransitionsFrom`). Hidden entirely when the
 * status is terminal (archived).
 */
export function CampaignStatusTransitions({
  campaignId,
  allowedTransitions,
}: CampaignStatusTransitionsProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSelect = (to: CampaignStatus): void => {
    setError(null);
    startTransition(async () => {
      const result = await transitionCampaignStatusAction(null, {
        campaignId,
        to,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            )}
            Cambiar estado
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {allowedTransitions.map((to) => (
            <DropdownMenuItem key={to} onSelect={() => onSelect(to)}>
              {LABEL[to]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {error}
        </span>
      ) : null}
    </div>
  );
}
