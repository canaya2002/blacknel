import { runPostInsightsSync } from '@/lib/connectors/post-insights-sync';

import { inngest } from '../client';

/**
 * Cron: poll per-post engagement for recently-published posts (C52) — platforms
 * don't push insights. Every 12h; upserts into post_insights under each
 * connection's org RLS. Logic in runPostInsightsSync for unit testing without
 * the Inngest harness.
 */
export const syncPostInsights = inngest.createFunction(
  { id: 'sync-post-insights', triggers: [{ cron: '0 */12 * * *' }] }, // every 12 hours
  async ({ step }) => step.run('sync', () => runPostInsightsSync()),
);
