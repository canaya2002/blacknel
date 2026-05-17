'use client';

import { Loader2, PlugZap } from 'lucide-react';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { disconnectAdsAccountAction } from '@/app/(app)/ads/actions';

interface AdsRowActionsProps {
  adsAccountId: string;
}

export function AdsRowActions({
  adsAccountId,
}: AdsRowActionsProps): React.ReactElement {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await disconnectAdsAccountAction(null, { adsAccountId });
        })
      }
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <PlugZap className="h-3.5 w-3.5" />
      )}
      Desconectar
    </Button>
  );
}
