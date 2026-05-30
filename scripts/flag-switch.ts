#!/usr/bin/env tsx
/**
 * Generic operator switch for app_settings feature flags (C44). Mirrors
 * scripts/{rls,ai}-switch.ts exactly (SET ROLE service_role + UPDATE
 * app_settings + RETURNING verify) but is parameterized by flag name:
 *
 *   pnpm db:flag use_real_storage on
 *   pnpm db:flag use_real_email status
 *   pnpm db:flag use_real_inngest off
 *
 * Allowlisted keys only (so a typo can't create a junk flag row). Covers the
 * C44 flags plus the earlier rls_dynamic / use_real_ai for one consistent CLI.
 *
 * Connection: DATABASE_URL (Session pooler). Needs service_role membership to
 * UPDATE; the pooler's postgres.<ref> user inherits it via migration 0000.
 */
import postgres from 'postgres';

import { env } from '../lib/env';
import { log } from '../lib/log';

const VALID_FLAGS = new Set([
  'rls_dynamic',
  'use_real_ai',
  'use_real_storage',
  'use_real_email',
  'use_real_inngest',
  'use_real_meta',
]);

type Action = 'on' | 'off' | 'status';

function parseArgs(argv: ReadonlyArray<string>): { key: string; action: Action } {
  const key = argv[2];
  const action = argv[3];
  if (!key || !VALID_FLAGS.has(key)) {
    console.error(
      `Usage: pnpm db:flag <${[...VALID_FLAGS].join('|')}> <on|off|status>`,
    );
    process.exit(1);
  }
  if (action !== 'on' && action !== 'off' && action !== 'status') {
    console.error('Action must be one of: on | off | status');
    process.exit(1);
  }
  return { key, action };
}

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    log.error('DATABASE_URL is not set. Pass `--env-file=.env.local` to tsx.');
    process.exit(1);
  }

  const { key, action } = parseArgs(process.argv);
  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    await sql`SET ROLE service_role`;

    if (action === 'status') {
      const rows = await sql<
        Array<{ value: string; updated_at: Date }>
      >`SELECT value, updated_at FROM public.app_settings WHERE key = ${key}`;
      const row = rows[0];
      if (!row) {
        log.warn(
          { key },
          'flag row missing from app_settings. Apply the seeding migration with `pnpm db:migrate`.',
        );
        return;
      }
      log.info(
        { flag: key, value: row.value, updated_at: row.updated_at.toISOString() },
        'flag.status',
      );
      return;
    }

    const updated = await sql<
      Array<{ value: string; updated_at: Date }>
    >`
      UPDATE public.app_settings
         SET value = ${action},
             updated_at = now()
       WHERE key = ${key}
       RETURNING value, updated_at
    `;
    const row = updated[0];
    if (!row) {
      throw new Error(
        `Flag '${key}' row missing from app_settings. Apply the seeding migration with \`pnpm db:migrate\` and retry.`,
      );
    }
    if (row.value !== action) {
      throw new Error(`UPDATE returned value=${row.value}, expected ${action}.`);
    }
    log.info(
      { flag: key, value: row.value, updated_at: row.updated_at.toISOString() },
      `flag.${action}`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'flag.failed');
  process.exit(1);
});
