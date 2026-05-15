#!/usr/bin/env tsx
/**
 * Apply every pending migration in `lib/db/migrations/` against the
 * configured `DATABASE_URL`. Migrations are SQL files; ordering is
 * lexical. Each file is applied once and only once — tracked by sha256
 * in a `_migrations` table the runner creates on first run.
 *
 *   pnpm db:migrate
 *
 * Idempotent. Re-running after a successful run is a no-op.
 *
 * NOTE: this script only targets the real-postgres path (Phase 11).
 * The dev pglite runtime applies the same migrations *automatically*
 * on first boot via `lib/db/dev-runtime.ts` — no manual step needed.
 */
import postgres from 'postgres';

import { applyMigrations, type MigrationRunnerAdapter } from '../lib/db/migrate';
import { env } from '../lib/env';
import { log } from '../lib/log';

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    log.error('DATABASE_URL is not set. Configure .env.local before running migrations.');
    process.exit(1);
  }

  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  const adapter: MigrationRunnerAdapter = {
    async exec(sqlText: string): Promise<void> {
      await sql.unsafe(sqlText);
    },
    async query<T = unknown>(
      sqlText: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<T[]> {
      // postgres-js `.unsafe(text, [params])` returns rows directly.
      // Params are runtime values (string / number / boolean / null) the
      // driver serialises; cast keeps `MigrationRunnerAdapter` adapter
      // agnostic between postgres-js and pglite.
      const rows = await sql.unsafe(
        sqlText,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params ? ([...params] as any[]) : [],
      );
      return rows as unknown as T[];
    },
  };

  try {
    const applied = await applyMigrations(adapter);
    log.info({ applied }, 'migrate.done');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'migrate.failed');
  process.exit(1);
});
