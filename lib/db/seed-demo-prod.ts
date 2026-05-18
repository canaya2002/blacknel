import 'server-only';

import { log } from '@/lib/log';

import { seedDatabase } from './seed';

import type { AnyPgTx } from './client';

/**
 * Phase 11 / Commit 40 — production demo org seed.
 *
 * Wraps the standard `seedDatabase` so production can populate
 * the same demo org Sales uses in dev (`SEED_IDS.org.demo` UUID
 * + all child records). Gated by `BLACKNEL_SEED_DEMO_ORG`. The
 * seed is idempotent (`ON CONFLICT DO NOTHING` throughout) so a
 * misfire doesn't trash anything.
 *
 * **Activation procedure** (`doc/runbooks/demo-org.md`):
 *
 *   1. `vercel env add BLACKNEL_SEED_DEMO_ORG true production`
 *   2. `vercel redeploy production --yes`
 *   3. Wait for boot, hit `/api/health`, verify `seedRanAt` log
 *   4. `vercel env rm BLACKNEL_SEED_DEMO_ORG production`
 *
 * After step 4, subsequent deploys do NOT re-seed.
 *
 * # Phase 11 / C42a — known gap under BLACKNEL_USE_REAL_AUTH=true
 *
 * The seed populates `public.users` with the deterministic
 * `SEED_IDS.user.*` UUIDs but does NOT create corresponding
 * `auth.users` rows. Under Supabase Auth that means the seeded
 * demo accounts cannot sign in via magic link out of the box —
 * a manual sign-up by the operator is needed for each account,
 * or a separate one-shot script that uses the REST admin API
 * (the typed SDK omits `id` from `AdminUserAttributes` so the
 * deterministic-UUID flow requires raw REST).
 *
 * Tracked as `phase-11-supabase-auth-seed-bridge` in TODO.md.
 * Workaround for the C42a soak: operator signs up using their
 * own email; the magic-link flow + Custom Access Token Hook
 * exercise end-to-end without seeded demo accounts.
 */
export async function seedDemoOrgForProd(tx: AnyPgTx): Promise<void> {
  log.info({ phase: 11 }, 'demo_org.seed.start');
  await seedDatabase(tx);
  log.info({ phase: 11 }, 'demo_org.seed.done');
}
