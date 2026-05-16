'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { deleteAssetAction } from '@/app/(app)/publish/assets/actions';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

interface AssetDeleteButtonProps {
  assetId: string;
  disabled?: boolean;
}

/**
 * Minimal delete CTA on each asset tile. Confirms via
 * `window.confirm()` and calls `deleteAssetAction`. A full
 * destructive-action modal lands in Commit 21 polish.
 *
 * Disabled when `disabled` is true — the parent passes the
 * `usedCount === 0` guard so assets in use can't be deleted
 * without first detaching them from posts.
 */
export function AssetDeleteButton({
  assetId,
  disabled,
}: AssetDeleteButtonProps): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const onClick = (): void => {
    if (pending || disabled) return;
    const ok = window.confirm('¿Eliminar este asset? Esta acción no se puede deshacer.');
    if (!ok) return;
    startTransition(async () => {
      const result = await deleteAssetAction(null, { assetId });
      if (result.ok) {
        router.refresh();
      } else {
        setFeedback(result.error.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClick}
        disabled={pending || disabled}
        title={
          disabled
            ? 'Este asset está en uso por uno o más posts.'
            : 'Eliminar asset'
        }
        className={cn(
          'h-6 w-full justify-start gap-1.5 px-1 text-[11px] text-muted-foreground',
          'hover:text-red-600',
        )}
      >
        <Trash2 className="h-3 w-3" aria-hidden />
        Eliminar
      </Button>
      {feedback ? (
        <span className="text-[10px] text-red-600" role="status">
          {feedback}
        </span>
      ) : null}
    </div>
  );
}
