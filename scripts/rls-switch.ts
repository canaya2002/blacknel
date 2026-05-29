#!/usr/bin/env tsx
/**
 * Phase 11 / Commit 42c — operator switch for the dynamic-RLS feature.
 *
<<<<<<< HEAD
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
=======
 *   pnpm db:rls on     → UPDATE app_settings SET value='on'  WHERE key='rls_dynamic'
 *   pnpm db:rls off    → UPDATE app_settings SET value='off' WHERE key='rls_dynamic'
 *   pnpm db:rls status → SELECT value, updated_at FROM app_settings WHERE key='rls_dynamic'
 *
 * # Why a table, not a GUC
 *
 * The original C42c plan used `blacknel.rls_dynamic` as a custom GUC flipped
 * via `ALTER DATABASE … SET …`. Supabase managed projects restrict this
 * statement to true superusers via the `supautils` extension; the `postgres`
 * role on hosted Supabase is NOT a true superuser. C42c-hotfix replaces the
 * GUC with the `app_settings` table (migration 0024) which `service_role`
 * can UPDATE. Same <1s rollback property; works on any Postgres deploy.
 *
 * # Persistence
 *
 * UPDATE commits immediately. Every NEW query plan that calls
 * `app_rls_dynamic_enabled()` sees the new value — STABLE function caches
 * per query plan only, not across queries. Existing in-flight long-running
 * queries on the OLD value finish on the old value (acceptable for sub-
 * second queries).
 *
 * # Idempotency
 *
 * Calling `on` twice is a no-op — the second UPDATE is the same row, same
 * value. The verify step confirms the persisted state matches the intent.
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf
 *
 * # Connection
 *
<<<<<<< HEAD
 *   - `DATABASE_URL` must be set (`--env-file=.env.local` typical).
 *   - Connecting role must hold UPDATE on `runtime_config` (postgres
 *     owns the table by default; service_role inherits via Supabase).
=======
 * Uses `DATABASE_URL` (Session pooler — see staging-environment.md). Needs
 * `service_role` membership to UPDATE the row. Pre-hotfix wiring (postgres-js
 * via session pooler with the `postgres.<ref>` user) inherits `service_role`
 * via membership granted in migration 0000.
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf
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
<<<<<<< HEAD
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
=======
  // max:1 — single short-lived connection. prepare:false is required by the
  // Transaction pooler; harmless on the Session pooler.
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    // Switch to service_role for the duration of this connection. The
    // pooler logs in as `postgres.<ref>` which has membership in
    // service_role via migration 0000 (`GRANT service_role TO postgres`).
    // We need SET ROLE (not SET LOCAL ROLE) because there's no enclosing
    // transaction here.
    await sql`SET ROLE service_role`;

    if (action === 'status') {
      const rows = await sql<
        Array<{ value: string; updated_at: Date }>
      >`SELECT value, updated_at FROM public.app_settings WHERE key = 'rls_dynamic'`;
      const row = rows[0];
      if (!row) {
        log.warn(
          'rls_dynamic row missing from app_settings. Apply migration 0024 with `pnpm db:migrate`.',
        );
        return;
      }
      log.info(
        { rls_dynamic: row.value, updated_at: row.updated_at.toISOString() },
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf
        'rls.status',
      );
      return;
    }

<<<<<<< HEAD
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
=======
    // on / off — UPDATE the row, then read back to confirm.
    const updated = await sql<
      Array<{ value: string; updated_at: Date }>
    >`
      UPDATE public.app_settings
         SET value = ${action},
             updated_at = now()
       WHERE key = 'rls_dynamic'
       RETURNING value, updated_at
    `;

    const row = updated[0];
    if (!row) {
      throw new Error(
        'rls_dynamic row missing from app_settings. Apply migration 0024 with `pnpm db:migrate` and retry.',
      );
    }
    if (row.value !== action) {
      throw new Error(
        `UPDATE returned value=${row.value}, expected ${action}.`,
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf
      );
    }

    log.info(
<<<<<<< HEAD
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
=======
      { rls_dynamic: row.value, updated_at: row.updated_at.toISOString() },
      `rls.${action}`,
    );
>>>>>>> 87f3d84a2a3d8946fce2c3e831d335402437c8bf
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'rls.failed');
  process.exit(1);
});
