import { PageHeader } from '@/components/common/page-header';
import { Skeleton } from '@/components/ui/skeleton';

export default function RequestsLoading(): React.ReactElement {
  return (
    <div className="flex flex-col">
      <PageHeader title="Review requests" description="Cargando…" />
      <div className="flex flex-col gap-4 px-6 py-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
