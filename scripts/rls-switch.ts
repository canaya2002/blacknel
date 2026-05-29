#!/usr/bin/env tsx
/**
 * Phase 11 / Commit 42c — operator switch for the dynamic-RLS feature.
 *
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
 *
 * # Connection
 *
 * Uses `DATABASE_URL` (Session pooler — see staging-environment.md). Needs
 * `service_role` membership to UPDATE the row. Pre-hotfix wiring (postgres-js
 * via session pooler with the `postgres.<ref>` user) inherits `service_role`
 * via membership granted in migration 0000.
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
        'rls.status',
      );
      return;
    }

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
      throw new Error(`UPDATE returned value=${row.value}, expected ${action}.`);
    }

    log.info(
      { rls_dynamic: row.value, updated_at: row.updated_at.toISOString() },
      `rls.${action}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'rls.failed');
  process.exit(1);
});
