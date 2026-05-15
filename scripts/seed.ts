#!/usr/bin/env tsx
/**
 * Apply the Phase-1 tenancy seed to the configured runtime.
 *
 *   pnpm db:seed
 *
 * Default runtime is the pglite dev DB at `.blacknel/pglite-data/`. To
 * seed a real Postgres (Phase 11), run with:
 *
 *   BLACKNEL_USE_MOCKS=false DATABASE_URL=postgres://... pnpm db:seed
 *
 * Idempotent — calls `seedDatabase()` which uses deterministic UUIDs +
 * ON CONFLICT DO UPDATE for every row.
 */
import { closeProdDb, dbAdmin } from '../lib/db/client';
import { seedDatabase } from '../lib/db/seed';
import { log } from '../lib/log';

async function main(): Promise<void> {
  log.info('seed.start');
  await dbAdmin(async (tx) => {
    await seedDatabase(tx);
  });
  log.info(
    {
      plans: 3,
      organizations: 1,
      brands: 2,
      locations: 5,
      users: 6,
      subscriptions: 1,
    },
    'seed.done',
  );
  await closeProdDb();
}

main().catch(async (err) => {
  log.error({ err }, 'seed.failed');
  await closeProdDb();
  process.exit(1);
});
