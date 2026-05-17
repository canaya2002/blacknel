/**
 * Skeleton for /publish/campaigns. Mirrors the structure of the
 * actual page so the layout doesn't reflow once data arrives.
 */
export default function CampaignsLoading(): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between border-b bg-card/30 px-6 py-3">
        <div className="flex flex-col gap-1">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="h-3 w-72 animate-pulse rounded bg-muted/60" />
        </div>
        <div className="h-8 w-32 animate-pulse rounded bg-muted" />
      </header>
      <div className="grid grid-cols-2 gap-3 px-6 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border bg-muted/40" />
        ))}
      </div>
      <div className="h-10 animate-pulse border-y bg-muted/30" />
      <div className="flex flex-col gap-px">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 animate-pulse border-b bg-muted/20" />
        ))}
      </div>
    </div>
  );
}
