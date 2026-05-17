import { CalendarRange } from 'lucide-react';

interface CampaignTimelineProps {
  startsAt: Date | null;
  endsAt: Date | null;
  /**
   * Reference clock injected from the Server Component. React 19
   * forbids `Date.now()` during render — the page passes
   * `new Date()` once at request time and we use it throughout.
   */
  now: Date;
}

/**
 * Visual progress bar from `starts_at` → `now` → `ends_at`. Three
 * rendering branches:
 *
 *   - both null              → "sin fechas" empty state.
 *   - starts in future       → "empieza en N días".
 *   - within window          → progress bar with elapsed %.
 *   - past ends_at           → "finalizada".
 *
 * Pure Server Component — no time-zone tricks; uses
 * `toLocaleDateString` for display only.
 */
export function CampaignTimeline({
  startsAt,
  endsAt,
  now,
}: CampaignTimelineProps): React.ReactElement {
  if (!startsAt && !endsAt) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarRange className="h-4 w-4" aria-hidden />
        Sin fechas configuradas.
      </div>
    );
  }
  const nowMs = now.getTime();
  const startMs = startsAt?.getTime() ?? null;
  const endMs = endsAt?.getTime() ?? null;

  if (startMs !== null && nowMs < startMs) {
    const daysToStart = Math.ceil((startMs - nowMs) / 86_400_000);
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-muted-foreground">
          Empieza en {daysToStart} día{daysToStart === 1 ? '' : 's'} ·{' '}
          {startsAt!.toLocaleDateString()}
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div className="h-full w-0 rounded-full bg-foreground/70" />
        </div>
      </div>
    );
  }
  if (endMs !== null && nowMs > endMs) {
    return (
      <div className="flex flex-col gap-1">
        <div className="text-xs text-muted-foreground">
          Finalizada el {endsAt!.toLocaleDateString()}.
        </div>
        <div className="h-2 w-full rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-foreground/40" />
        </div>
      </div>
    );
  }
  // In window — compute % between start..end.
  if (startMs !== null && endMs !== null) {
    const total = endMs - startMs;
    const elapsed = Math.max(0, nowMs - startMs);
    const pct = total > 0 ? Math.min(100, Math.round((elapsed / total) * 100)) : 0;
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>{startsAt!.toLocaleDateString()}</span>
          <span>{pct}% transcurrido</span>
          <span>{endsAt!.toLocaleDateString()}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-foreground/70"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }
  // Open-ended (no endsAt, already past startsAt).
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted-foreground">
        En curso desde {startsAt!.toLocaleDateString()} (sin fecha de cierre).
      </div>
      <div className="h-2 w-full rounded-full bg-muted">
        <div className="h-full w-1/2 rounded-full bg-foreground/40" />
      </div>
    </div>
  );
}
