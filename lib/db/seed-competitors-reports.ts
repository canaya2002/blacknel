import 'server-only';

import { generateCompetitorMetricForDay } from '../connectors/competitors/mock';
import {
  competitorMetricsDaily,
  competitors,
  scheduledReports,
} from './schema';
import { nextRunAfter } from '../scheduled-reports/schedule';
import { SEED_IDS } from './seed';

import type { AnyPgTx } from './client';

/**
 * Competitors + scheduled-reports demo seed (Phase 9 / Commit 34).
 *
 * Gated by `env.BLACKNEL_SEED_COMPETITORS_REPORTS`. Tests turn it
 * off via `tests/helpers/react-act-setup.ts`.
 *
 * What lands:
 *   - 3 competitors per demo org with platform handles + active
 *     status.
 *   - 30 days of pre-computed metrics across the watched platforms
 *     (~600 rows total). Generated via the same mock that the
 *     cron uses, so the demo data shape matches runtime output.
 *   - 1 active weekly scheduled report (`mon 09:00` in
 *     `America/Mexico_City`), recipients pointed at the demo
 *     billing email.
 */

const ORG = SEED_IDS.org.demo;

const COMPETITOR_SEEDS = [
  {
    id: '88888888-8888-4888-8888-000000034001',
    name: 'Trattoria Bella',
    brandId: SEED_IDS.brand.trattoria,
    platforms: ['instagram', 'x'] as const,
    handles: {
      instagram: '@trattoriabella',
      x: '@trattoria_bella',
    },
  },
  {
    id: '88888888-8888-4888-8888-000000034002',
    name: 'Italian Kitchen MX',
    brandId: SEED_IDS.brand.trattoria,
    platforms: ['instagram', 'tiktok'] as const,
    handles: {
      instagram: '@italiankitchenmx',
      tiktok: '@italiankitchenmx',
    },
  },
  {
    id: '88888888-8888-4888-8888-000000034003',
    name: 'Clínica Vital',
    brandId: SEED_IDS.brand.clinica,
    platforms: ['facebook', 'instagram'] as const,
    handles: {
      facebook: '@clinicavital',
      instagram: '@clinicavital.mx',
    },
  },
];

const SCHEDULED_REPORT_ID = '88888888-8888-4888-8888-000000034099';

export async function seedCompetitorsReports(tx: AnyPgTx): Promise<void> {
  // 1. Competitors.
  await tx
    .insert(competitors)
    .values(
      COMPETITOR_SEEDS.map((c) => ({
        id: c.id,
        organizationId: ORG,
        brandId: c.brandId,
        name: c.name,
        platforms: [...c.platforms],
        handles: c.handles,
        status: 'active' as const,
      })),
    )
    .onConflictDoNothing({ target: competitors.id });

  // 2. Metrics — 30 days × platforms per competitor. Deterministic
  // mock; ON CONFLICT DO NOTHING so re-running the seed is a no-op.
  const today = new Date();
  const metricsRows: Array<typeof competitorMetricsDaily.$inferInsert> = [];
  for (const c of COMPETITOR_SEEDS) {
    for (const platform of c.platforms) {
      for (let d = 0; d < 30; d += 1) {
        const day = new Date(today.getTime() - d * 86_400_000);
        const dayIso = day.toISOString().slice(0, 10);
        const metric = generateCompetitorMetricForDay({
          orgId: ORG,
          competitorId: c.id,
          day: dayIso,
          platform,
          // Pretend the org publishes 6-12 own posts per day on each
          // platform — gives an SoV roughly inside [0.2, 0.8].
          ownPostsCount: 6 + (d % 7),
        });
        metricsRows.push({
          organizationId: ORG,
          competitorId: c.id,
          platform,
          day: dayIso,
          postsCount: metric.postsCount,
          engagementTotal: metric.engagementTotal,
          sentimentScore: metric.sentimentScore.toFixed(2),
          shareOfVoice: metric.shareOfVoice.toFixed(3),
        });
      }
    }
  }
  if (metricsRows.length > 0) {
    await tx
      .insert(competitorMetricsDaily)
      .values(metricsRows)
      .onConflictDoNothing({
        target: [
          competitorMetricsDaily.competitorId,
          competitorMetricsDaily.platform,
          competitorMetricsDaily.day,
        ],
      });
  }

  // 3. One active weekly scheduled report.
  const nextRunAt = nextRunAfter(
    'mon 09:00',
    'America/Mexico_City',
    today,
  );
  if (nextRunAt) {
    await tx
      .insert(scheduledReports)
      .values({
        id: SCHEDULED_REPORT_ID,
        organizationId: ORG,
        name: 'Brand overview semanal',
        kind: 'weekly',
        scheduleExpr: 'mon 09:00',
        recipients: ['reporting@blacknel.demo'],
        status: 'active',
        nextRunAt,
      })
      .onConflictDoNothing({ target: scheduledReports.id });
  }
}
