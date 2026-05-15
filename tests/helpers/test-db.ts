/**
 * In-memory Postgres for integration tests, courtesy of pglite.
 *
 * Why pglite: it's a real Postgres compiled to WASM and runs in-process
 * without Docker. It supports the things that matter to Blacknel — RLS,
 * triggers, ENUMs, CREATE ROLE, GRANT, SET LOCAL ROLE, `current_setting`
 * — so RLS tests written here exercise the *actual* policies we ship to
 * production. The Supabase Cloud `blacknel-dev` project is the
 * second-line check; this is the first.
 *
 * The fixture:
 *   1. Stubs `auth.users` so migration 0003 can attach its trigger.
 *   2. Applies every `lib/db/migrations/*.sql` file in lexical order.
 *   3. Returns a Drizzle instance plus a `dispose` callback.
 *
 * Each test gets a fresh DB if it wants strict isolation; many tests
 * share one DB and seed inside `beforeAll` with `runAdmin`.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../../lib/db/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '../../lib/db/migrations');

export type TestDb = {
  pg: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
  dispose: () => Promise<void>;
};

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();

  // Wait for pglite to be ready before issuing SQL.
  await pg.waitReady;

  // ---- 1. Stub Supabase Auth schema -------------------------------------
  // Supabase normally provisions auth.users via GoTrue. For a plain
  // Postgres-in-WASM we have to create a stand-in so migration 0003 can
  // attach `on_auth_user_created` to it.
  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id          uuid PRIMARY KEY,
      email       text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);

  // ---- 2. Apply migrations ----------------------------------------------
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sqlText = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await pg.exec(sqlText);
    } catch (err) {
      // Bubble up with the filename so failures are debuggable.
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
  }

  const db = drizzle(pg, { schema });

  return {
    pg,
    db,
    dispose: async () => {
      await pg.close();
    },
  };
}
