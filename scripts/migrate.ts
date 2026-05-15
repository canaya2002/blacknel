#!/usr/bin/env tsx
/**
 * Apply every pending migration in `lib/db/migrations/` against the
 * configured `DATABASE_URL`. Migrations are SQL files; ordering is
 * lexical. Each file is applied once and only once — tracked in a
 * `_migrations` table the script creates on first run.
 *
 *   pnpm db:migrate
 *
 * Idempotent. Re-running after a successful run is a no-op.
 *
 * Aborts if a previously-applied file has been edited (sha256 drift),
 * because re-running an edited migration on top of itself is almost
 * always wrong. Treat applied migrations as immutable — add new files
 * for changes.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

import { env } from '../lib/env';
import { log } from '../lib/log';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../lib/db/migrations');

async function main(): Promise<void> {
  if (!env.DATABASE_URL) {
    log.error('DATABASE_URL is not set. Configure .env.local before running migrations.');
    process.exit(1);
  }

  const sql = postgres(env.DATABASE_URL, { max: 1, prepare: false });

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename    text PRIMARY KEY,
        sha256      text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      );
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      log.warn('No migration files found in lib/db/migrations/');
      return;
    }

    const applied = new Map<string, string>(
      (await sql<{ filename: string; sha256: string }[]>`
        SELECT filename, sha256 FROM _migrations
      `).map((row) => [row.filename, row.sha256]),
    );

    let appliedCount = 0;
    for (const filename of files) {
      const fullPath = path.join(MIGRATIONS_DIR, filename);
      const contents = await readFile(fullPath, 'utf8');
      const sha = createHash('sha256').update(contents).digest('hex');

      const prevSha = applied.get(filename);
      if (prevSha === sha) {
        log.debug({ filename }, 'migration.skip (already applied)');
        continue;
      }
      if (prevSha && prevSha !== sha) {
        log.error(
          { filename, prevSha, currentSha: sha },
          'migration.drift — applied migration was edited after the fact. Aborting.',
        );
        process.exit(2);
      }

      log.info({ filename }, 'migration.apply');
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`
          INSERT INTO _migrations (filename, sha256) VALUES (${filename}, ${sha})
        `;
      });
      appliedCount += 1;
    }

    log.info({ applied: appliedCount, total: files.length }, 'migration.done');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  log.error({ err }, 'migration.failed');
  process.exit(1);
});
