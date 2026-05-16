import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import { createTestDb } from '../helpers/test-db';

/**
 * Phase-5 closing seed health check. Boots a fresh pglite + applies
 * migrations + runs `seedDatabase()`, then reports timing + row
 * counts for every seeded table.
 *
 * Asserts (Task B acceptance criteria):
 *
 *   - Full seed completes in <2s.
 *   - With `BLACKNEL_SEED_CONNECTED=true` (default), `connected_accounts`
 *     contains 8 rows distributed 6 connected / 1 expired / 1 error,
 *     plus 16 sync runs (2 per account).
 *   - With `BLACKNEL_SEED_CONNECTED=false`, `connected_accounts` stays
 *     at 0 — integration tests that opt out keep their seeded worlds
 *     minimal.
 *
 * Each test re-imports `seedDatabase` after `vi.stubEnv` so the env
 * module re-parses with the stubbed flag. Without `resetModules()` +
 * dynamic import the singleton `env` constant retains its boot-time
 * value.
 *
 * Module name starts with `_` so vitest schedules it early; doesn't
 * otherwise matter.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

async function countByTable(
  fixtureDb: Awaited<ReturnType<typeof createTestDb>>['db'],
  tables: ReadonlyArray<string>,
): Promise<Array<{ table: string; n: number }>> {
  return runAdmin<Array<{ table: string; n: number }>>(fixtureDb, async (tx) => {
    const out: Array<{ table: string; n: number }> = [];
    for (const table of tables) {
      const rows = await tx.execute(
        sql.raw(`SELECT COUNT(*)::int AS n FROM ${table}`),
      );
      // Drizzle-pglite returns `{ rows: [{ n: <number> }] }`; the
      // postgres-js adapter returns the array directly. Normalize.
      const first =
        'rows' in rows && Array.isArray((rows as { rows: unknown[] }).rows)
          ? (rows as { rows: Array<{ n: number }> }).rows[0]
          : (rows as unknown as Array<{ n: number }>)[0];
      out.push({ table, n: first?.n ?? 0 });
    }
    return out;
  });
}

describe('seed health check', () => {
  it('default flags: seeds in <2s with 8 connected_accounts (6/1/1) + 16 sync runs', async () => {
    vi.stubEnv('BLACKNEL_SEED_CONNECTED', 'true');
    vi.resetModules();
    const { seedDatabase } = await import('../../lib/db/seed');

    const startBoot = Date.now();
    const fixture = await createTestDb();
    const bootMs = Date.now() - startBoot;

    const startSeed = Date.now();
    await runAdmin(fixture.db, async (tx) => {
      await seedDatabase(tx);
    });
    const seedMs = Date.now() - startSeed;

    const counts = await countByTable(fixture.db, [
      'plans',
      'users',
      'organizations',
      'organization_members',
      'brands',
      'locations',
      'subscriptions',
      'saved_replies',
      'contact_profiles',
      'inbox_threads',
      'inbox_messages',
      'internal_notes',
      'approvals',
      'reviews',
      'review_responses',
      'review_requests',
      'reputation_snapshots',
      'audit_events',
      'connected_accounts',
      'connector_sync_runs',
    ]);

    const byStatus = await runAdmin<Array<{ status: string; n: number }>>(
      fixture.db,
      async (tx) => {
        const rows = await tx.execute(
          sql.raw(
            `SELECT status::text AS status, COUNT(*)::int AS n
             FROM connected_accounts GROUP BY status ORDER BY status`,
          ),
        );
        const arr =
          'rows' in rows && Array.isArray((rows as { rows: unknown[] }).rows)
            ? (rows as { rows: Array<{ status: string; n: number }> }).rows
            : (rows as unknown as Array<{ status: string; n: number }>);
        return arr;
      },
    );

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '── Seed health check (BLACKNEL_SEED_CONNECTED=true) ──',
        `pglite boot + migrations: ${bootMs} ms`,
        `seedDatabase():           ${seedMs} ms`,
        '── Row counts ────────────────────────────────────────',
        ...counts.map((c) => `  ${c.table.padEnd(24)} ${c.n}`),
        '── connected_accounts by status ──────────────────────',
        ...byStatus.map((s) => `  ${s.status.padEnd(24)} ${s.n}`),
        '──────────────────────────────────────────────────────',
      ].join('\n'),
    );

    // <2s acceptance criterion.
    expect(seedMs).toBeLessThan(2000);
    expect(bootMs).toBeLessThan(10000);

    const connectedRow = counts.find((c) => c.table === 'connected_accounts');
    expect(connectedRow?.n).toBe(8);

    const statusMap = Object.fromEntries(byStatus.map((s) => [s.status, s.n]));
    expect(statusMap.connected).toBe(6);
    expect(statusMap.expired).toBe(1);
    expect(statusMap.error).toBe(1);

    const runsRow = counts.find((c) => c.table === 'connector_sync_runs');
    expect(runsRow?.n).toBe(16);

    await fixture.dispose();
  });

  it('flag off: BLACKNEL_SEED_CONNECTED=false leaves connected_accounts empty', async () => {
    vi.stubEnv('BLACKNEL_SEED_CONNECTED', 'false');
    vi.resetModules();
    const { seedDatabase } = await import('../../lib/db/seed');

    const fixture = await createTestDb();
    await runAdmin(fixture.db, async (tx) => {
      await seedDatabase(tx);
    });

    const counts = await countByTable(fixture.db, [
      'connected_accounts',
      'connector_sync_runs',
      // Sanity: the rest of the seed still runs.
      'plans',
      'organizations',
      'reviews',
    ]);
    const byTable = Object.fromEntries(counts.map((c) => [c.table, c.n]));
    expect(byTable.connected_accounts).toBe(0);
    expect(byTable.connector_sync_runs).toBe(0);
    expect(byTable.plans).toBe(3);
    expect(byTable.organizations).toBe(1);
    expect(byTable.reviews).toBeGreaterThan(0);

    await fixture.dispose();
  });
});
