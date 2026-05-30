import { runAdsStructureSync } from '@/lib/ads-connectors/ads-structure-sync';
import { runAdsSyncTick } from '@/lib/jobs/ads-sync';

import { inngest } from '../client';

/**
 * Cron: ads pillar sync (C50) — ad platforms (Meta first) give no spend webhooks
 * so a cron polls. Two steps every 6h: (1) discover ad accounts + sync the
 * campaign→ad-set→ad structure, then (2) pull daily insights into
 * `ads_spend_daily`. Structure runs first so newly-discovered accounts get
 * insights the same tick. Both orchestrators are plain async fns (unit-testable
 * without the Inngest harness) and self-isolate failures per account.
 */
export const syncAds = inngest.createFunction(
  { id: 'sync-ads', triggers: [{ cron: '0 */6 * * *' }] }, // every 6 hours
  async ({ step }) => {
    const structure = await step.run('structure', () => runAdsStructureSync());
    const insights = await step.run('insights', () => runAdsSyncTick());
    return { structure, insights };
  },
);
