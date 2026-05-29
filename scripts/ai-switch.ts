#!/usr/bin/env tsx
/**
 * Phase 11 / Commit 43a — operator switch for the real-AI cutover flag.
 *
 *   pnpm db:ai on     → UPDATE app_settings SET value='on'  WHERE key='use_real_ai'
 *   pnpm db:ai off    → UPDATE app_settings SET value='off' WHERE key='use_real_ai'
 *   pnpm db:ai status → SELECT value, updated_at FROM app_settings WHERE key='use_real_ai'
 *
 * Mirrors `scripts/rls-switch.ts` exactly (same app_settings mechanism). The
 * flag is the operator half of the real-AI gate: the real Anthropic adapter
 * serves only when this is 'on' AND env.BLACKNEL_USE_REAL_AI=true AND
 * ANTHROPIC_API_KEY is set (lib/ai/client.ts). Flipping to 'off' rolls back to
 * the deterministic mock within ~1s for every new request — no redeploy.
 *
 * # Connection
 *
 * Uses `DATABASE_URL` (Session pooler). Needs `service_role` membership to
 * UPDATE the row; the pooler's `postgres.<ref>` user inherits it via the
 * membership granted in migration 0000.
 */
import postgres from 'postgres';

import { env } from '../lib/env';
import { log } from '../lib/log';

type Action = 'on' | 'off' | 'status';

function parseAction(argv: ReadonlyArray<string>): Action {
  const raw = argv[2];
  if (raw === 'on' || raw === 'off' || raw === 'status') return raw;
  console.error('Usage: pnpm db:ai <on|off|status>');
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
    // service_role for the duration of this connection (RLS-irrelevant here —
    // app_settings has no RLS — but service_role holds the UPDATE grant).
    await sql`SET ROLE service_role`;

    if (action === 'status') {
      const rows = await sql<
        Array<{ value: string; updated_at: Date }>
      >`SELECT value, updated_at FROM public.app_settings WHERE key = 'use_real_ai'`;
      const row = rows[0];
      if (!row) {
        log.warn(
          'use_real_ai row missing from app_settings. Apply migration 0028 with `pnpm db:migrate`.',
        );
        return;
      }
      log.info(
        { use_real_ai: row.value, updated_at: row.updated_at.toISOString() },
        'ai.status',
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
       WHERE key = 'use_real_ai'
       RETURNING value, updated_at
    `;

    const row = updated[0];
    if (!row) {
      throw new Error(
        'use_real_ai row missing from app_settings. Apply migration 0028 with `pnpm db:migrate` and retry.',
      );
    }
    if (row.value !== action) {
      throw new Error(`UPDATE returned value=${row.value}, expected ${action}.`);
    }

    log.info(
      { use_real_ai: row.value, updated_at: row.updated_at.toISOString() },
      `ai.${action}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'ai.failed');
  process.exit(1);
});
