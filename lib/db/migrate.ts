import 'server-only';

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { log } from '../log';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MIGRATIONS_DIR = path.resolve(__dirname, './migrations');

/**
 * Minimal runner shape — abstracts over postgres-js (production) and
 * pglite (dev runtime + tests). Both expose `exec(sql)` for the multi-
 * statement migrations we ship; postgres-js callers wrap a single
 * statement runner instead.
 */
export interface MigrationRunnerAdapter {
  /** Run one migration file's worth of SQL (may contain many statements). */
  exec(sqlText: string): Promise<void>;
  /** Execute parameterized query, returning row objects. */
  query<T = unknown>(sqlText: string, params?: ReadonlyArray<unknown>): Promise<T[]>;
}

/**
 * Apply every `*.sql` file in `lib/db/migrations/` against the given
 * adapter, in lexical order. Tracks applied files by sha256 in
 * `_migrations`. Refuses to re-run a previously-applied file whose
 * content has changed (treat applied migrations as immutable — add a
 * new file).
 *
 * Returns the number of newly-applied migrations.
 */
export async function applyMigrations(adapter: MigrationRunnerAdapter): Promise<number> {
  await adapter.exec(`
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
    log.warn('migrate.empty — no migration files found');
    return 0;
  }

  const appliedRows = await adapter.query<{ filename: string; sha256: string }>(
    `SELECT filename, sha256 FROM _migrations`,
  );
  const applied = new Map(appliedRows.map((r) => [r.filename, r.sha256]));

  let appliedCount = 0;
  for (const filename of files) {
    const fullPath = path.join(MIGRATIONS_DIR, filename);
    const contents = await readFile(fullPath, 'utf8');
    const sha = createHash('sha256').update(contents).digest('hex');

    const prevSha = applied.get(filename);
    if (prevSha === sha) continue;
    if (prevSha && prevSha !== sha) {
      throw new Error(
        `migration drift: ${filename} was edited after it was applied. ` +
          'Applied migrations are immutable — add a new file instead.',
      );
    }

    log.info({ filename }, 'migrate.apply');
    await adapter.exec(contents);
    await adapter.query(
      `INSERT INTO _migrations (filename, sha256) VALUES ($1, $2)`,
      [filename, sha],
    );
    appliedCount += 1;
  }

  return appliedCount;
}
