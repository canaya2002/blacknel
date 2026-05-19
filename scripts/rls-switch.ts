#!/usr/bin/env tsx
/**
 * Phase 11 / Commit 42c — operator switch for the dynamic-RLS feature.
 *
 *   pnpm db:rls on     → UPDATE runtime_config SET value = 'on'  WHERE key = 'rls_dynamic'
 *   pnpm db:rls off    → UPDATE runtime_config SET value = 'off' WHERE key = 'rls_dynamic'
 *   pnpm db:rls status → SELECT value FROM runtime_config WHERE key = 'rls_dynamic'
 *
 * # History
 *
 * Originally backed by a custom GUC `blacknel.rls_dynamic` flipped via
 * `ALTER DATABASE … SET …`. Supabase managed rejects that path with
 * 42501 (custom GUCs are not registered for non-superuser ALTER), so
 * migration 0024 moved the source of truth to a `runtime_config` row.
 * Function `app_rls_dynamic_enabled()` still reads the session-local
 * setting first — that keeps `SET LOCAL blacknel.rls_dynamic = 'on'`
 * working inside CI tests without rewriting them.
 *
 * # Persistence
 *
 * Plain UPDATE. Visible to any new transaction immediately (vs. the old
 * ALTER DATABASE which only affected new connections). Existing
 * transactions started before the UPDATE keep the snapshot they saw.
 *
 * # Idempotency
 *
 * UPDATE-only — the row is seeded by migration 0024. Calling `on` twice
 * is harmless. The verify step confirms the final state.
 *
 * # Pre-requirements
 *
 *   - `DATABASE_URL` must be set (`--env-file=.env.local` typical).
 *   - Connecting role must hold UPDATE on `runtime_config` (postgres
 *     owns the table by default; service_role inherits via Supabase).
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
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    const dbRows = await sql<Array<{ db: string }>>`SELECT current_database() AS db`;
    const dbName = dbRows[0]?.db;
    if (!dbName) {
      throw new Error('Could not resolve current_database().');
    }

    if (action === 'status') {
      const rows = await sql<Array<{ value: string; updated_at: Date }>>`
        SELECT value, updated_at
        FROM runtime_config
        WHERE key = 'rls_dynamic'
      `;
      const value = rows[0]?.value ?? '(unset → off)';
      log.info(
        {
          database: dbName,
          rls_dynamic: value,
          updated_at: rows[0]?.updated_at,
        },
        'rls.status',
      );
      return;
    }

    // on / off — UPDATE the table, then read back to verify.
    const updated = await sql<Array<{ value: string; updated_at: Date }>>`
      UPDATE runtime_config
      SET value = ${action}, updated_at = now()
      WHERE key = 'rls_dynamic'
      RETURNING value, updated_at
    `;

    if (updated.length === 0) {
      throw new Error(
        "runtime_config row for key='rls_dynamic' does not exist. Run migration 0024.",
      );
    }
    if (updated[0]!.value !== action) {
      throw new Error(
        `UPDATE appeared to succeed but value is ${updated[0]!.value}, expected ${action}.`,
      );
    }

    log.info(
      {
        database: dbName,
        rls_dynamic: updated[0]!.value,
        updated_at: updated[0]!.updated_at,
      },
      `rls.${action}`,
    );
    // Effect is immediate for new transactions (vs. old ALTER DATABASE which
    // required connections to cycle). Existing in-flight transactions see
    // their snapshot until they commit.
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'rls.failed');
  process.exit(1);
});
