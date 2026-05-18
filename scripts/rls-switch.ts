#!/usr/bin/env tsx
/**
 * Phase 11 / Commit 42c — operator switch for the dynamic-RLS feature.
 *
 *   pnpm db:rls on     → ALTER DATABASE … SET blacknel.rls_dynamic = 'on'
 *   pnpm db:rls off    → ALTER DATABASE … SET blacknel.rls_dynamic = 'off'
 *   pnpm db:rls status → SELECT current_setting('blacknel.rls_dynamic', true)
 *
 * The setting controls whether the RESTRICTIVE policies installed by
 * migration 0023 actually enforce permissions, or short-circuit as
 * no-ops. Default (no ALTER DATABASE applied) is 'off' — same behavior
 * as pre-C42c.
 *
 * # Persistence
 *
 * `ALTER DATABASE … SET …` is a server-side default that persists across
 * restarts and applies to all NEW sessions. Existing sessions keep their
 * inherited value; they need to be reset (close + reconnect) to pick up
 * the new value. Postgres pool reconnects pick it up automatically once
 * connections cycle.
 *
 * # Rollback procedure (full)
 *
 * See `doc/runbooks/rls-rollback.md`. TL;DR: `pnpm db:rls off` + watch
 * Sentry for 10 min. App behavior reverts to C42b tenant-only RLS.
 *
 * # Idempotency
 *
 * Calling `on` twice is a no-op — the second ALTER DATABASE is the same
 * statement. The verify step confirms the final state matches the intent.
 *
 * # Pre-requirements
 *
 *   - `DATABASE_URL` must be set (passed via `--env-file=.env.local` or
 *     shell env). The script uses postgres-js direct, not the pooler;
 *     ALTER DATABASE on the Transaction pooler can hang.
 *   - The connecting role must be a Postgres superuser (Supabase's
 *     `postgres` role is — verify with `SELECT rolsuper FROM pg_roles
 *     WHERE rolname = current_user`). The Session pooler used by
 *     `pnpm db:migrate` is the right choice here.
 */
import postgres from 'postgres';

import { env } from '../lib/env';
import { log } from '../lib/log';

type Action = 'on' | 'off' | 'status';

function parseAction(argv: ReadonlyArray<string>): Action {
  const raw = argv[2];
  if (raw === 'on' || raw === 'off' || raw === 'status') return raw;
  console.error('Usage: pnpm db:rls <on|off|status>');
  process.exit(1);
}

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    log.error('DATABASE_URL is not set. Pass `--env-file=.env.local` to tsx.');
    process.exit(1);
  }

  const action = parseAction(process.argv);
  // max:1 — single short-lived connection, the script issues one DDL.
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    // current_database() returns the DB this connection is attached to.
    // ALTER DATABASE needs the literal name (not a parameter) so we read
    // it first and interpolate via sql.unsafe — safe because the value
    // comes from the live server, not user input.
    const dbRows = await sql<Array<{ db: string }>>`SELECT current_database() AS db`;
    const dbName = dbRows[0]?.db;
    if (!dbName) {
      throw new Error('Could not resolve current_database().');
    }

    if (action === 'status') {
      // current_setting('…', true) returns NULL when the setting is unset
      // database-side AND not set in this session — for `status` we want
      // the database-default, so query pg_db_role_setting directly.
      const dbDefaults = await sql<
        Array<{ setting: string }>
      >`
        SELECT unnest(setconfig) AS setting
        FROM pg_db_role_setting
        WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = ${dbName})
          AND setrole = 0
      `;
      const match = dbDefaults
        .map((r) => r.setting)
        .find((s) => s.startsWith('blacknel.rls_dynamic='));
      const value = match ? match.split('=')[1] : '(unset → off)';
      log.info({ database: dbName, blacknel_rls_dynamic: value }, 'rls.status');
      return;
    }

    // on / off — issue the ALTER, then read back via pg_db_role_setting
    // (current_setting reflects the SESSION value, which won't change
    // until reconnect).
    //
    // ALTER DATABASE is DDL: no parameter binding, identifier + value
    // must be in the literal SQL. `dbName` comes from `current_database()`
    // (server-supplied, no injection vector) and `action` is validated
    // to 'on' | 'off' above. Double-quote the identifier per spec and
    // double-up embedded quotes defensively in case a future operator
    // names a DB with one.
    const quotedDb = `"${dbName.replace(/"/g, '""')}"`;
    await sql.unsafe(
      `ALTER DATABASE ${quotedDb} SET blacknel.rls_dynamic = '${action}'`,
    );

    const dbDefaults = await sql<
      Array<{ setting: string }>
    >`
      SELECT unnest(setconfig) AS setting
      FROM pg_db_role_setting
      WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = ${dbName})
        AND setrole = 0
    `;
    const match = dbDefaults
      .map((r) => r.setting)
      .find((s) => s.startsWith('blacknel.rls_dynamic='));
    const persisted = match ? match.split('=')[1] : null;

    if (persisted !== action) {
      throw new Error(
        `ALTER DATABASE appeared to succeed but persisted value is ${persisted}, expected ${action}.`,
      );
    }

    log.info(
      { database: dbName, blacknel_rls_dynamic: persisted },
      `rls.${action}`,
    );
    // Existing pooled connections inherited the OLD value until they cycle.
    // Vercel Functions cycle within ~10 min for cold restarts; new requests
    // pick up the new value on next connect.
    log.warn(
      'Existing pooled connections retain the OLD value until they recycle. ' +
        'Sessions opened AFTER this command see the new value immediately.',
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'rls.failed');
  process.exit(1);
});
