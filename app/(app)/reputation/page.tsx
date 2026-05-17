import { PageHeader } from '@/components/common/page-header';
import { CrisisAlertBanner } from '@/components/reputation/crisis-alert-banner';
import { CrisisRecommendationsBanner } from '@/components/reputation/crisis-recommendations-banner';
import { FiltersBar } from '@/components/reputation/filters-bar';
import { KpiCard } from '@/components/reputation/kpi-card';
import { RatingDistributionChart } from '@/components/reputation/rating-distribution-chart';
import { RatingTrendLine } from '@/components/reputation/rating-trend-line';
import { ResponseTimeCard } from '@/components/reputation/response-time-card';
import { SentimentPie } from '@/components/reputation/sentiment-pie';
import { TopTagsList } from '@/components/reputation/top-tags-list';
import { requireUser } from '@/lib/auth/server';
import { listCrisisRecommendations } from '@/lib/ai/recommendations';
import { authorize, can } from '@/lib/permissions/can';
import { parseReputationFilters } from '@/lib/reputation/filters';
import { loadReputationDashboardData } from '@/lib/reputation/queries';

export const dynamic = 'force-dynamic';

interface ReputationPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /reputation — Commit 15.
 *
 * Single-pass dashboard. The page does ONE call to
 * `loadReputationDashboardData` (Ajuste extra) which fans out to all
 * the per-card queries in parallel under one `dbAs` transaction. The
 * components below are presentational — they receive their slice of
 * the payload as props and don't fetch anything themselves.
 *
 * Permission: `reviews:read` covers reading aggregations over the
 * reviews table — the same surface that gates /reviews. Owners /
 * admins / managers / agents / viewers all have it.
 */
export default async function ReputationPage({
  searchParams,
}: ReputationPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'reviews:read');

  const sp = await searchParams;
  const now = new Date();
  const filters = parseReputationFilters(sp, { now });

  const [data, crisisRecs] = await Promise.all([
    loadReputationDashboardData({
      orgId: session.orgId,
      userId: session.userId,
      filters,
      now,
    }),
    listCrisisRecommendations({
      orgId: session.orgId,
      userId: session.userId,
      status: ['pending'],
      limit: 10,
    }),
  ]);
  const canDecideCrisis = can(session.role, 'crisis:decide');

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reputation"
        description="Rating consolidado, distribución por estrellas, evolución del rating semanal, temas más frecuentes, tiempo de respuesta y detección automática de crisis cuando hay un spike negativo en las últimas 72h."
      />
      <FiltersBar filters={data.filters} />

      <div className="flex flex-col gap-4 px-6 py-4">
        <CrisisRecommendationsBanner
          recommendations={crisisRecs}
          canDecide={canDecideCrisis}
        />
        <CrisisAlertBanner crisis={data.crisis} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Rating promedio"
            value={
              data.current.ratingAvg === null
                ? '—'
                : `${data.current.ratingAvg.toFixed(2)} ★`
            }
            caption={`${data.current.reviewCount} reseña${data.current.reviewCount === 1 ? '' : 's'} en el período`}
            delta={data.deltas.ratingAvg}
            deltaLabel={
              data.deltas.ratingAvg.delta !== null
                ? `${data.deltas.ratingAvg.delta > 0 ? '+' : ''}${data.deltas.ratingAvg.delta.toFixed(2)} ★`
                : undefined
            }
            goodDirection="up"
          />
          <KpiCard
            title="Volumen de reseñas"
            value={String(data.current.reviewCount)}
            caption={`vs ${data.previous.reviewCount} en período anterior`}
            delta={data.deltas.reviewCount}
            goodDirection="up"
          />
          <KpiCard
            title="Tasa de respuesta"
            value={
              data.current.responseRate === null
                ? '—'
                : `${Math.round(data.current.responseRate)}%`
            }
            caption={`${data.current.responseCount} respondidas`}
            delta={data.deltas.responseRate}
            deltaLabel={
              data.deltas.responseRate.delta !== null
                ? `${data.deltas.responseRate.delta > 0 ? '+' : ''}${Math.round(data.deltas.responseRate.delta)}pp`
                : undefined
            }
            goodDirection="up"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <RatingTrendLine trend={data.trend} />
          <RatingDistributionChart stars={data.stars} />
          <SentimentPie sentiment={data.sentiment} />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <TopTagsList tags={data.topTags} />
          <ResponseTimeCard stats={data.responseTime} />
        </div>
      </div>
    </div>
  );
}
