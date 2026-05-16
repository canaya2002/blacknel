import { PageHeader } from '@/components/common/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Inbox loading skeleton. Mirrors the final structure: header,
 * filters bar, then a tall column of thread-row placeholders so the
 * layout doesn't reflow when the data lands.
 */
export default function InboxLoading(): React.ReactElement {
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        title="Inbox"
        description="Cargando conversaciones…"
      />

      <div className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-4 py-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-28" />
      </div>

      <div className="flex-1 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 border-b px-4 py-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="ml-auto h-3 w-10" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
              <div className="flex gap-1.5 pt-0.5">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-3 w-14" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
