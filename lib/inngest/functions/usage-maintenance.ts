import { log } from '@/lib/log';

import { inngest } from '../client';

/**
 * Cron: usage-counter housekeeping. The C43b windowed counters
 * (postsPerMonth, aiGenerationsPerMonth, …) roll forward on READ
 * (lib/usage/counters.readUsage), so there is NO monthly reset to perform —
 * this cron is the housekeeping hook (future: prune very old windowed rows).
 * A safe heartbeat no-op for now so the schedule + wiring exist.
 */
export async function runUsageMaintenance(): Promise<{ ok: true }> {
  log.info('inngest.usage_maintenance.heartbeat');
  return { ok: true };
}

export const usageMaintenance = inngest.createFunction(
  { id: 'usage-maintenance', triggers: [{ cron: '0 3 * * *' }] }, // daily 03:00 UTC
  async ({ step }) => step.run('maintain', () => runUsageMaintenance()),
);
