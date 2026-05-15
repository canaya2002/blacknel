import { Skeleton } from '@/components/ui/skeleton';

/**
 * Standard skeleton used by every Phase-1 module's `loading.tsx`.
 * Mirrors the structure of the eventual page (header → empty state /
 * grid of cards) so the transition feels like content materialising,
 * not a wholesale repaint.
 */
export function ModuleSkeleton(): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 pb-6">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-32 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
