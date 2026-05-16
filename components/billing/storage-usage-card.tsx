import { HardDrive, Images } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils/cn';

interface StorageUsageCardProps {
  /** Current `assetsInLibrary` count. */
  assetsCount: number;
  /** Cap for `assetsInLibrary` (-1 = unlimited). */
  assetsCap: number;
  /** Current `storageBytes` value. */
  storageBytesUsed: number;
  /** Cap for `storageBytes` (-1 = unlimited). */
  storageBytesCap: number;
}

/**
 * Two-row card for /billing surfacing the asset library quotas
 * (Commit 19b — D-19b-1 + D-19b-2). The byte values are
 * formatted with `formatBytes` so the user reads "X MB / Y GB"
 * instead of raw numbers. Each row uses the same color escalation
 * as `UsageCard` (amber at ≥80%, destructive at the cap).
 */
export function StorageUsageCard({
  assetsCount,
  assetsCap,
  storageBytesUsed,
  storageBytesCap,
}: StorageUsageCardProps): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Almacenamiento</CardTitle>
        <CardDescription>
          Espacio y número de assets del plan. Borrar archivos no usados libera
          espacio inmediatamente. Subir de plan amplía ambos caps.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <QuotaRow
          icon={<Images className="h-4 w-4" aria-hidden />}
          label="Assets en biblioteca"
          current={assetsCount}
          cap={assetsCap}
          formatValue={(v) => v.toLocaleString('en-US')}
        />
        <QuotaRow
          icon={<HardDrive className="h-4 w-4" aria-hidden />}
          label="Almacenamiento total"
          current={storageBytesUsed}
          cap={storageBytesCap}
          formatValue={formatBytes}
        />
      </CardContent>
    </Card>
  );
}

function QuotaRow({
  icon,
  label,
  current,
  cap,
  formatValue,
}: {
  icon: React.ReactNode;
  label: string;
  current: number;
  cap: number;
  formatValue: (v: number) => string;
}): React.ReactElement {
  const isUnlimited = cap === -1;
  const ratio = isUnlimited ? 0 : Math.min(100, (current / Math.max(1, cap)) * 100);
  const reached = !isUnlimited && current >= cap;
  const near = !isUnlimited && !reached && ratio >= 80;
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card/30 p-3">
      <div className="flex items-baseline justify-between">
        <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </span>
        <span
          className={cn(
            'font-mono text-sm font-semibold',
            reached && 'text-destructive',
            near && 'text-amber-600',
          )}
        >
          {formatValue(current)} / {isUnlimited ? '∞' : formatValue(cap)}
        </span>
      </div>
      {!isUnlimited ? (
        <Progress
          value={ratio}
          className={cn(
            'h-1.5',
            reached && '[&>div]:bg-destructive',
            near && !reached && '[&>div]:bg-amber-500',
          )}
        />
      ) : (
        <Progress value={20} className="h-1.5 opacity-30" />
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 0) return '∞';
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 1_000_000_000) {
    const mb = bytes / 1_000_000;
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  const gb = bytes / 1_000_000_000;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}
