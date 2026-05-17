import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SovBar } from '@/components/competitors/sov-bar';
import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { getCompetitorDetail } from '@/lib/competitors/queries';
import { authorize } from '@/lib/permissions/can';
import { planAllowsNamedFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface CompetitorDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * /competitors/[id] — Phase 9 / Commit 35 (Detail-page template).
 *
 * 5 sections:
 *   1. PageHeader        — name + back link + status badge
 *   2. KPI cards row     — total posts 30d, avg SoV, avg sentiment
 *   3. Trend             — 30d posts/day (placeholder text + sparse list)
 *   4. Platform breakdown table
 *   5. Footer            — handles per platform
 */
export default async function CompetitorDetailPage({
  params,
}: CompetitorDetailPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'competitors:read');

  const plan = await getOrgPlanCode(session);
  if (!planAllowsNamedFeature(plan, 'competitors_tracking')) {
    notFound();
  }

  const { id } = await params;
  const detail = await getCompetitorDetail({
    orgId: session.orgId,
    userId: session.userId,
    competitorId: id,
  });
  if (!detail) {
    notFound();
  }

  const { competitor, breakdown, trendLast30d } = detail;
  const totalPosts = breakdown.reduce((s, b) => s + b.postsLast30d, 0);
  const avgSov =
    breakdown.length === 0
      ? 0
      : breakdown.reduce((s, b) => s + b.avgShareOfVoice, 0) /
        breakdown.length;
  const avgSentiment =
    breakdown.length === 0
      ? 0
      : breakdown.reduce((s, b) => s + b.avgSentiment, 0) /
        breakdown.length;
  const peakDay = [...trendLast30d].sort(
    (a, b) => b.postsCount - a.postsCount,
  )[0];

  return (
    <div
      className="flex flex-col gap-6 px-6 py-6"
      data-testid="competitor-detail"
    >
      {/* 1. PageHeader */}
      <PageHeader
        title={competitor.name}
        description={`${competitor.brandName ?? 'Todas las brands'} · ${competitor.platforms.join(', ')}`}
        eyebrow={
          <Link href="/competitors" className="hover:underline">
            ← Volver a Competidores
          </Link>
        }
        actions={
          <span
            className={
              competitor.status === 'active'
                ? 'rounded-md border border-emerald-500/40 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'rounded-md border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
            }
          >
            {competitor.status}
          </span>
        }
      />

      {/* 2. KPI cards row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <KpiTile label="Posts 30d" value={String(totalPosts)} />
        <KpiTile
          label="SoV promedio 30d"
          value={`${(avgSov * 100).toFixed(0)}%`}
        />
        <KpiTile
          label="Sentiment promedio"
          value={avgSentiment.toFixed(2)}
        />
        <KpiTile
          label="Plataformas monitoreadas"
          value={String(competitor.platforms.length)}
        />
      </div>

      {/* 3. Trend section */}
      <section
        className="flex flex-col gap-2"
        data-testid="competitor-trend"
      >
        <h2 className="text-sm font-semibold">Trend rolling 30 días</h2>
        {trendLast30d.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Sin métricas todavía. El cron diario captura datos en las
            próximas 24 horas (sparkline visual en Fase 10).
          </Card>
        ) : (
          <Card className="flex flex-col gap-2 p-4 text-sm">
            <p className="text-muted-foreground">
              {trendLast30d.length} días con datos · pico de actividad:{' '}
              <span className="font-mono text-foreground">
                {peakDay?.day ?? '—'}
              </span>{' '}
              ({peakDay?.postsCount ?? 0} posts). Sparkline visual
              aterriza en Fase 10.
            </p>
            <div className="flex flex-wrap items-end gap-1 pt-2">
              {trendLast30d.map((t) => {
                const max = Math.max(
                  ...trendLast30d.map((p) => p.postsCount),
                  1,
                );
                const heightPct = (t.postsCount / max) * 100;
                return (
                  <div
                    key={t.day}
                    className="flex flex-col items-center gap-1"
                  >
                    <div
                      className="w-2 rounded-sm bg-primary/60"
                      style={{ height: `${Math.max(2, heightPct * 0.4)}px` }}
                      title={`${t.day}: ${t.postsCount} posts`}
                    />
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </section>

      {/* 4. Platform breakdown table */}
      <section
        className="flex flex-col gap-2"
        data-testid="competitor-breakdown"
      >
        <h2 className="text-sm font-semibold">Breakdown por plataforma</h2>
        {breakdown.length === 0 ? (
          <Card className="p-4 text-sm text-muted-foreground">
            Sin datos por plataforma todavía.
          </Card>
        ) : (
          <Card className="divide-y">
            {breakdown.map((b) => (
              <div
                key={b.platform}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`breakdown-${b.platform}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{b.platform}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.postsLast30d} posts · {b.engagementLast30d}{' '}
                    engagement · sentiment {b.avgSentiment.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">SoV</span>
                  <SovBar sov={b.avgShareOfVoice} />
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* 5. Footer — handles */}
      <footer
        className="border-t pt-4 text-sm"
        data-testid="competitor-handles"
      >
        <span className="font-medium">Handles por plataforma</span>
        <ul className="mt-2 flex flex-wrap gap-2 text-xs">
          {Object.entries(competitor.handles).length === 0 ? (
            <li className="text-muted-foreground">
              (sin handles registrados)
            </li>
          ) : (
            Object.entries(competitor.handles).map(([platform, handle]) => (
              <li
                key={platform}
                className="rounded-md border bg-muted/40 px-2 py-1"
              >
                <span className="font-medium">{platform}</span>:{' '}
                <span className="font-mono">{handle}</span>
              </li>
            ))
          )}
        </ul>
      </footer>
    </div>
  );
}

function KpiTile({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <Card className="flex flex-col gap-1 p-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </Card>
  );
}
