import { Skeleton } from '@/components/ui/skeleton';

export default function ThreadDetailLoading(): React.ReactElement {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>

      <div className="grid flex-1 grid-cols-[1fr_320px] overflow-hidden">
        <div className="flex flex-col gap-4 border-r p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className={i % 2 === 0 ? 'flex justify-start' : 'flex justify-end'}
            >
              <Skeleton className={i % 2 === 0 ? 'h-16 w-2/3' : 'h-12 w-1/2'} />
            </div>
          ))}
          <Skeleton className="mt-auto h-32 w-full" />
        </div>
        <div className="flex flex-col gap-3 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
