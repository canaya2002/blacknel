import Link from 'next/link';
import { AlertOctagon, History } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { CrisisRecListItem, CrisisSeverity } from '@/lib/ai/recommendations';

import { CrisisDecisionToolbar } from './crisis-decision-toolbar';

interface CrisisRecommendationsBannerProps {
  recommendations: ReadonlyArray<CrisisRecListItem>;
  canDecide: boolean;
}

const SEVERITY_TONE: Readonly<Record<CrisisSeverity, { label: string; className: string }>> = {
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
 * AI-driven crisis recommendations banner (Phase 7 / Commit 25).
 *
 * Renders one card per pending `ai_recommendations` row with
 * `category='crisis'`. Each card shows the severity badge,
 * title, summary, evidence counts, recommended action, and an
 * `<CrisisDecisionToolbar />` with Aceptar / Descartar buttons
 * when the caller has `crisis:decide`.
 *
 * Hidden entirely when `recommendations` is empty — the page
 * renders the standard reputation surface without banner clutter.
 *
 * **Distinct from `<CrisisAlertBanner />`** (Phase 5) — that one
 * is the heuristic crisis-rule trigger; this one is the AI-driven
 * pattern detector that lands in `ai_recommendations` with a
 * formal decision lifecycle.
 */
export function CrisisRecommendationsBanner({
  recommendations,
  canDecide,
}: CrisisRecommendationsBannerProps): React.ReactElement | null {
  if (recommendations.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {recommendations.map((rec) => {
        const tone = SEVERITY_TONE[rec.severity];
        const totalIds = rec.reviewIds.length + rec.messageIds.length;
        return (
          <Card
            key={rec.id}
            className="border-red-500/40 bg-red-500/5"
            data-testid="crisis-rec-banner"
          >
            <CardContent className="flex flex-col gap-3 p-4">
              <header className="flex flex-wrap items-start gap-3">
                <AlertOctagon
                  className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
                  aria-hidden
                />
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-red-900 dark:text-red-100">
                      {rec.title}
                    </span>
                    <Badge className={tone.className}>
                      Severidad: {tone.label}
                    </Badge>
                    {rec.brandName ? (
                      <Badge variant="muted" className="text-[10px] uppercase">
                        {rec.brandName}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-red-900/80 dark:text-red-100/80">
                    {rec.body}
                  </p>
                </div>
              </header>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-red-900/80 dark:text-red-100/80">
                <span>
                  Evidencia: {rec.reviewIds.length} reseña
                  {rec.reviewIds.length === 1 ? '' : 's'} · {rec.messageIds.length}{' '}
                  mensaje{rec.messageIds.length === 1 ? '' : 's'} ({totalIds} total)
                </span>
                <span>
                  Detectada{' '}
                  <time dateTime={rec.createdAt.toISOString()}>
                    {rec.createdAt.toLocaleString()}
                  </time>
                </span>
              </div>

              {rec.recommendedAction ? (
                <div className="rounded-md bg-red-100/40 px-3 py-2 text-xs text-red-900 dark:bg-red-950/40 dark:text-red-100">
                  <span className="font-medium">Acción sugerida:</span>{' '}
                  {rec.recommendedAction}
                </div>
              ) : null}

              {canDecide ? (
                <CrisisDecisionToolbar recommendationId={rec.id} />
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Solo un manager o admin puede decidir sobre esta alerta.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Link
        href="/reputation/crisis/history"
        prefetch={false}
        className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <History className="h-3.5 w-3.5" aria-hidden />
        Ver historial de crisis decididas
      </Link>
    </div>
  );
}
