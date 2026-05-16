import { Skeleton } from '@/components/ui/skeleton';

export default function ReviewDetailLoading(): React.ReactElement {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <header className="flex flex-col gap-4 border-b px-6 py-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-24 w-full rounded-md" />
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 py-3">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
      <div className="border-t bg-card/30 px-4 py-4">
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
