import { CalendarClock, Check, History, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type {
  CrisisRecListItem,
  CrisisSeverity,
} from '@/lib/ai/recommendations';

interface CrisisHistoryListProps {
  recommendations: ReadonlyArray<CrisisRecListItem>;
}

const SEVERITY_TONE: Readonly<
  Record<CrisisSeverity, { label: string; className: string }>
> = {
  low: {
    label: 'Bajo',
    className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  },
  medium: {
    label: 'Medio',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  },
  high: {
    label: 'Alto',
    className: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
  },
  critical: {
    label: 'Crítico',
    className: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  },
};

/**
 * History view list for /reputation/crisis/history. Pure Server
 * Component — reads the slice from the page loader and renders
 * each rec as an expandable summary card.
 */
export function CrisisHistoryList({
  recommendations,
}: CrisisHistoryListProps): React.ReactElement {
  if (recommendations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/30 px-6 py-12 text-center">
        <History className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">Sin historial de crisis</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Las alertas que un manager acepte o descarte desde el banner de
          /reputation aterrizan aquí. La vista cubre los últimos 90 días.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {recommendations.map((rec) => {
        const tone = SEVERITY_TONE[rec.severity];
        const accepted = rec.status === 'accepted';
        return (
          <Card key={rec.id} className="border bg-card/30" data-testid="crisis-history-row">
            <CardContent className="flex flex-col gap-3 p-4">
              <header className="flex flex-wrap items-start gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{rec.title}</span>
                    <Badge className={tone.className}>
                      Severidad: {tone.label}
                    </Badge>
                    <Badge
                      className={
                        accepted
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                          : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200'
                      }
                    >
                      {accepted ? (
                        <>
                          <Check className="mr-1 h-3 w-3" aria-hidden />
                          Aceptada
                        </>
                      ) : (
                        <>
                          <X className="mr-1 h-3 w-3" aria-hidden />
                          Descartada
                        </>
                      )}
                    </Badge>
                    {rec.brandName ? (
                      <Badge variant="muted" className="text-[10px] uppercase">
                        {rec.brandName}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{rec.body}</p>
                </div>
              </header>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3 w-3" aria-hidden />
                  Decidida{' '}
                  {rec.decidedAt ? (
                    <time dateTime={rec.decidedAt.toISOString()}>
                      {rec.decidedAt.toLocaleString()}
                    </time>
                  ) : (
                    '—'
                  )}
                  {rec.decidedByName ? ` por ${rec.decidedByName}` : ''}
                </span>
                <span>
                  Evidencia: {rec.reviewIds.length} reseña
                  {rec.reviewIds.length === 1 ? '' : 's'} ·{' '}
                  {rec.messageIds.length} mensaje
                  {rec.messageIds.length === 1 ? '' : 's'}
                </span>
              </div>

              {!accepted && rec.decisionReason ? (
                <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium">Razón del descarte:</span>{' '}
                  {rec.decisionReason}
                </div>
              ) : null}

              {rec.recommendedAction ? (
                <div className="rounded-md bg-muted/30 px-3 py-2 text-xs">
                  <span className="font-medium">Acción sugerida:</span>{' '}
                  {rec.recommendedAction}
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
