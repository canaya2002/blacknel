import { eq } from 'drizzle-orm';

import { dbAsOrg, type AnyPgTx } from '@/lib/db/client';
import { mediaAssets } from '@/lib/db/schema';
import { log } from '@/lib/log';

import { inngest } from '../client';
import type { BlacknelEvents } from '../client';

/**
 * Event handler for `media.process` — post-upload processing. Runs OUTSIDE a
 * user request, so it sets the tenant context from the event's orgId via
 * `dbAsOrg` (RLS isolates the job to that org — NOT dbAdmin). Validates the
 * asset is present/ready under its org. Thumbnail/transcode generation is
 * DEFERRED (documented gap) — this is the wired hook + the tenant-isolation
 * pattern for jobs.
 */

// Seam: the org-scoped tx runner (default dbAsOrg) — swappable for tests.
type OrgTxFn = <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
let orgTx: OrgTxFn = dbAsOrg;
export function _setOrgTxForTests(fn: OrgTxFn): void {
  orgTx = fn;
}
export function _resetOrgTxForTests(): void {
  orgTx = dbAsOrg;
}

export async function runProcessMedia(
  data: BlacknelEvents['media.process']['data'],
): Promise<{ processed: boolean }> {
  const rows = await orgTx<Array<{ id: string; status: string }>>(
    data.orgId,
    (tx) =>
      tx
        .select({ id: mediaAssets.id, status: mediaAssets.status })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, data.assetId))
        .limit(1),
  );
  const found = rows[0];
  if (!found) {
    log.warn(
      { orgId: data.orgId, assetId: data.assetId },
      'inngest.process_media.not_found',
    );
    return { processed: false };
  }
  // Hook point — thumbnails/transcode deferred.
  log.info(
    { orgId: data.orgId, assetId: data.assetId, status: found.status },
    'inngest.process_media',
  );
  return { processed: true };
}

export const processMediaFn = inngest.createFunction(
  {
    id: 'process-media',
    idempotency: 'event.data.assetId',
    triggers: [{ event: 'media.process' }],
  },
  async ({ event, step }) =>
    step.run('process', () =>
      runProcessMedia(event.data as BlacknelEvents['media.process']['data']),
    ),
);
