import { Skeleton } from '@/components/ui/skeleton';

export default function FeedbackLoading(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-10 sm:py-16">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-md" />
        <div className="flex flex-col gap-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-6 w-3/4" />
      <div className="flex items-center gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-12 rounded" />
        ))}
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-12 w-32" />
    </div>
  );
}
