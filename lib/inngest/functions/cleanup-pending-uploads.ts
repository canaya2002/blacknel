import { reapStalePendingUploads } from '@/lib/storage/media/client';
import { log } from '@/lib/log';

import { inngest } from '../client';

/**
 * Cron: reap media_assets stuck in `pending` for >24h (client never confirmed
 * the upload) + their R2 objects. System-wide sweep (admin), per-row by id —
 * no cross-tenant exposure. Logic extracted to `runCleanupPendingUploads` so
 * it's unit-testable without the Inngest harness.
 */

const STALE_MS = 24 * 60 * 60 * 1000;

export async function runCleanupPendingUploads(
  olderThanMs: number = STALE_MS,
): Promise<number> {
  const reaped = await reapStalePendingUploads(olderThanMs);
  log.info({ reaped }, 'inngest.cleanup_pending_uploads');
  return reaped;
}

export const cleanupPendingUploads = inngest.createFunction(
  { id: 'cleanup-pending-uploads', triggers: [{ cron: '0 * * * *' }] }, // hourly
  async ({ step }) => step.run('reap', () => runCleanupPendingUploads()),
);
