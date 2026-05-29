import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from '../db/client';
import { appSettings } from '../db/schema';

/**
 * Runtime read of the `use_real_ai` flag (C43a), the operator half of the
 * real-AI gate. Read FRESH per call (no TTL) so `pnpm db:ai off` rolls back to
 * the mock within one request — mirroring the recompute-per-query freshness of
 * the C42c `rls_dynamic` gate. The single indexed SELECT is negligible next to
 * the AI API call it precedes. Fail-CLOSED: any DB error returns false (serve
 * the mock) so a blip never silently bills the real API.
 *
 * The read is behind a swappable reader so unit tests don't need a DB.
 */

type FlagReader = () => Promise<string | null>;

async function dbReader(): Promise<string | null> {
  const rows = await dbAdmin<Array<{ value: string }>>((tx) =>
    tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'use_real_ai'))
      .limit(1),
  );
  return rows[0]?.value ?? null;
}

let reader: FlagReader = dbReader;

/** Test seam — inject a reader so `isRealAiEnabled` is testable without a DB. */
export function _setFlagReaderForTests(r: FlagReader): void {
  reader = r;
}

export function _resetFlagReaderForTests(): void {
  reader = dbReader;
}

export async function isRealAiEnabled(): Promise<boolean> {
  try {
    return (await reader()) === 'on';
  } catch {
    return false;
  }
}
