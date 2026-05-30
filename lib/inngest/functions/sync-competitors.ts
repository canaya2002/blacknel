import { runCompetitorsSync } from '@/lib/connectors/competitors-sync';

import { inngest } from '../client';

/**
 * Cron: snapshot competitor daily metrics (C53) — competitor_metrics_daily was
 * only seed-fed; this populates it at runtime. Daily; upserts one row per
 * (competitor, platform, day) under each org's RLS. Deterministic generator
 * today (no free competitor API — see runCompetitorsSync). Logic is unit-testable
 * without the Inngest harness.
 */
export const syncCompetitors = inngest.createFunction(
  { id: 'sync-competitors', triggers: [{ cron: '0 5 * * *' }] }, // daily 05:00 UTC
  async ({ step }) => step.run('sync', () => runCompetitorsSync()),
);
