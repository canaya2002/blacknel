import { Card } from '@/components/ui/card';

interface AuditDiffRow {
  readonly id: string;
  readonly action: string;
  readonly actorLabel: string;
  readonly createdAt: Date;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

interface AuditDiffProps {
  events: ReadonlyArray<AuditDiffRow>;
}

/**
 * Audit diff section (Phase 10 / Commit 36b · Ajuste 2).
 *
 * Same JSX pattern as the brand-voice audit diff (Commit 26).
 * For each event we render before/after JSON blobs side by side
 * (where both exist) or just `after` for create / archive.
 */
export function CustomRoleAuditDiff({
  events,
}: AuditDiffProps): React.ReactElement {
  if (events.length === 0) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Sin historial de cambios todavía.
      </Card>
    );
  }
  return (
    <Card className="divide-y">
      {events.map((e) => (
        <div
          key={e.id}
          className="flex flex-col gap-1 p-3"
          data-testid={`audit-diff-${e.id}`}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-foreground">{e.action}</span>
            <span className="text-muted-foreground">
              {e.createdAt.toLocaleString()} · {e.actorLabel}
            </span>
          </div>
          {e.before && e.after ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Before
                </div>
                <pre className="overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                  {JSON.stringify(e.before, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  After
                </div>
                <pre className="overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                  {JSON.stringify(e.after, null, 2)}
                </pre>
              </div>
            </div>
          ) : e.after ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                After
              </div>
              <pre className="overflow-auto rounded bg-muted/40 p-2 text-[11px]">
                {JSON.stringify(e.after, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
