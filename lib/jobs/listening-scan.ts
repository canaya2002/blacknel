import 'server-only';

import { eq } from 'drizzle-orm';

import { scanForMentionsMock } from '@/lib/connectors/listening/mock';
import { type AnyPgTx, dbAdmin } from '@/lib/db/client';
import {
  listeningTrackedTerms,
  type ListeningTrackedTerm,
} from '@/lib/db/schema';
import { persistMention } from '@/lib/listening/persist';
import { log } from '@/lib/log';
import { ok, type Result } from '@/lib/types/result';

/**
 * Listening cron tick (Phase 9 / Commit 33).
 *
 * Every 60 minutes:
 *
 *   1. Scan all `listening_tracked_terms` rows with `status=active`
 *      across every org. The cross-tenant SCAN is the only place
 *      we use `dbAdmin` — same posture as `nps-scan` (Commit 32)
 *      and `crisis-scan` (Phase 7).
 *
 *   2. For each term, call the deterministic mock connector
 *      (`scanForMentionsMock`) — produces 0-20 mentions/day
 *      depending on `termKind`.
 *
 *   3. Persist each mention via `persistMention`. That helper
 *      classifies sentiment + intent through Phase-7 AI skills,
 *      then INSERTs with `ON CONFLICT DO NOTHING` so re-runs of
 *      the same `(org, platform, external_id)` are no-ops.
 *
 * R-33-1 invariant: AI skills are invoked here, NEVER in the seed.
 */

export interface ListeningScanDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: ListeningScanDeps = {
  asAdmin: (fn) => dbAdmin(fn),
};

export interface ListeningScanResult {
  readonly termsScanned: number;
  readonly mentionsCaptured: number;
  readonly mentionsSkipped: number;
}

export async function runListeningScanTick(input?: {
  now?: Date;
  deps?: ListeningScanDeps;
}): Promise<Result<ListeningScanResult>> {
  const now = input?.now ?? new Date();
  const deps = input?.deps ?? defaultDeps;

  const terms: ListeningTrackedTerm[] = await deps.asAdmin((tx) =>
    tx
      .select()
      .from(listeningTrackedTerms)
      .where(eq(listeningTrackedTerms.status, 'active')),
  );

  let mentionsCaptured = 0;
  let mentionsSkipped = 0;

  for (const term of terms) {
    const candidates = scanForMentionsMock({
      orgId: term.organizationId,
      trackedTermId: term.id,
      term: term.term,
      termKind: term.termKind,
      platforms: term.platforms,
      now,
    });
    if (candidates.length === 0) continue;

    // Each persist is its own transaction so a single bad mention
    // doesn't roll back the rest of the batch.
    for (const candidate of candidates) {
      try {
        const r = await deps.asAdmin((tx) =>
          persistMention(tx, {
            organizationId: term.organizationId,
            trackedTermId: term.id,
            brandId: term.brandId,
            mention: candidate,
          }),
        );
        if (r.skipped) mentionsSkipped += 1;
        else mentionsCaptured += 1;
      } catch (cause) {
        log.warn(
          {
            err: (cause as Error).message,
            organizationId: term.organizationId,
            trackedTermId: term.id,
            externalId: candidate.externalId,
          },
          'listening.persist.failed',
        );
        mentionsSkipped += 1;
      }
    }
  }

  log.info(
    {
      termsScanned: terms.length,
      mentionsCaptured,
      mentionsSkipped,
    },
    'listening.scan.tick',
  );

  return ok({
    termsScanned: terms.length,
    mentionsCaptured,
    mentionsSkipped,
  });
}

// Used by cron-loop.ts as the single-arg entry point. Same wrapper
// shape as runNpsScanTick, runAdsAlertsScanTick, etc.
export async function runListeningScanTickEntry(): Promise<
  Result<ListeningScanResult>
> {
  return runListeningScanTick();
}
