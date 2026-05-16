import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton mirroring the Commit-18 /publish layout so the page
 * transition feels like content materialising. Top-to-bottom:
 *
 *   - Page header strip (eyebrow + title + description + actions)
 *   - 6 KPI cards
 *   - 5 view-tab placeholders
 *   - 1 filter bar
 *   - 6×7 calendar grid (or list of rows on mobile via md hides)
 */
export default function Loading(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 px-6 pt-6 pb-6">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 px-6 pb-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
      <div className="flex items-center gap-2 border-b px-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="my-2 h-6 w-24" />
        ))}
      </div>
      <div className="flex items-center gap-2 border-b bg-card/30 px-6 py-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="ml-auto h-8 w-56" />
      </div>
      <div className="hidden flex-col px-6 py-3 md:flex">
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={`hdr-${i}`} className="h-8 rounded-none" />
          ))}
          {Array.from({ length: 42 }).map((_, i) => (
            <Skeleton key={`cell-${i}`} className="h-28 rounded-none" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 px-6 py-3 md:hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
