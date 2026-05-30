import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin } from './db/client';
import { appSettings } from './db/schema';

/**
 * Generic runtime feature-flag reader (C44). Mirrors the C42c/C43a pattern:
 * the source of truth is a row in `app_settings`, read FRESH per call so an
 * operator `pnpm db:flag <name> off` rolls back within one request. Fail-CLOSED:
 * any DB error returns false (serve the mock) so a blip never silently flips a
 * subsystem to the real (paid / external) provider.
 *
 * C43a's `use_real_ai` keeps its own reader (lib/ai/runtime-flag.ts); the C44
 * subsystems use this one.
 */

export type RuntimeFlag =
  | 'use_real_storage'
  | 'use_real_email'
  | 'use_real_inngest'
  | 'use_real_meta'
  | 'use_real_linkedin'
  | 'use_real_tiktok'
  | 'use_real_x'
  | 'use_real_youtube'
  | 'use_real_gbp';

type FlagReader = (key: string) => Promise<string | null>;

async function dbReader(key: string): Promise<string | null> {
  const rows = await dbAdmin<Array<{ value: string }>>((tx) =>
    tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, key))
      .limit(1),
  );
  return rows[0]?.value ?? null;
}

let reader: FlagReader = dbReader;

/** Test seam — inject a reader so callers are testable without a DB. */
export function _setFlagReaderForTests(r: FlagReader): void {
  reader = r;
}

export function _resetFlagReaderForTests(): void {
  reader = dbReader;
}

export async function isFlagOn(key: RuntimeFlag): Promise<boolean> {
  try {
    return (await reader(key)) === 'on';
  } catch {
    return false;
  }
}
