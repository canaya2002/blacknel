import { PageHeader } from '@/components/common/page-header';
import { Skeleton } from '@/components/ui/skeleton';

export default function ReputationLoading(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader title="Reputation" description="Cargando métricas…" />
      <div className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-6 py-2">
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-col gap-4 px-6 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-60 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
