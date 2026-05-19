import 'server-only';

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { log } from '../log';

import { runAdmin } from './client';
import { applyMigrations, type MigrationRunnerAdapter } from './migrate';
import { seedDatabase } from './seed';
import * as schema from './schema';

/**
 * pglite-backed dev runtime. The whole stack — Server Components,
 * Server Actions, Route Handlers — runs against a real Postgres
 * (compiled to WASM) persisted to `.blacknel/pglite-data/`. No Docker,
 * no Supabase, no external creds while we're in Phases 1–10.
 *
 * Phase 11 cutover flips `BLACKNEL_USE_MOCKS=false` and swaps the
 * backing client to postgres-js + Supabase. Migrations and schema stay
 * identical — same SQL files apply to both.
 */

export const DEV_DATA_DIR = path.resolve(process.cwd(), '.blacknel/pglite-data');

let _devInstance: {
  pg: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
} | null = null;

let _devBootPromise: Promise<{
  pg: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
}> | null = null;

/**
 * Build or return the singleton dev pglite. Concurrent callers during
 * the same boot share the in-flight promise so we never run migrations
 * twice in parallel.
 */
export async function getDevDb(): Promise<ReturnType<typeof drizzle<typeof schema>>> {
  if (_devInstance) return _devInstance.db;
  if (_devBootPromise) {
    const instance = await _devBootPromise;
    return instance.db;
  }

  _devBootPromise = bootDevDb();
  _devInstance = await _devBootPromise;
  return _devInstance.db;
}

async function bootDevDb(): Promise<{
  pg: PGlite;
  db: ReturnType<typeof drizzle<typeof schema>>;
}> {
  // Phase 11 / C41 — defense in depth: the pglite dev runtime writes to
  // `.blacknel/pglite-data/` under `process.cwd()`. On Vercel / Lambda
  // that resolves to `/var/task`, a read-only filesystem — `mkdir` throws
  // a cryptic ENOENT and the whole request crashes. Fail fast here with
  // a legible message so the operator sees the real cause (a flag
  // misconfigured for the target environment) instead of a stack trace.
  if (
    process.env.VERCEL === '1' ||
    typeof process.env.AWS_LAMBDA_FUNCTION_NAME === 'string'
  ) {
    throw new Error(
      'pglite dev runtime cannot run in a serverless environment. This indicates ' +
        'BLACKNEL_USE_MOCKS is true (or unset) in a Vercel/Lambda deployment. ' +
        'Set BLACKNEL_USE_MOCKS=false and configure DATABASE_URL — see ' +
        'doc/runbooks/staging-environment.md for the operator setup.',
    );
  }

  log.info({ dataDir: DEV_DATA_DIR }, 'db.dev.boot');

  // pglite opens-or-creates the data directory but expects its parent to
  // exist. `mkdir -p` is cheap and makes a cold-start boot safe.
  await mkdir(DEV_DATA_DIR, { recursive: true });

  const pg = new PGlite(DEV_DATA_DIR);
  await pg.waitReady;

  // Stub `auth.users` so migration 0003 can attach its trigger. In
  // Phase 11 production this table is owned by Supabase Auth (GoTrue);
  // here it's a thin local table we control.
  //
  // Stub the `anon` role too — Supabase ships it pre-provisioned for
  // unauthenticated requests; pglite does not. Migration 0024 GRANTs
  // SELECT on runtime_config TO anon, which fails without this stub.
  // 0000_setup.sql already wraps `authenticated` and `service_role`
  // with the same idempotent CREATE pattern — this is the third role
  // and stays out of the migration so we don't drift the applied sha
  // on prod.
  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id          uuid PRIMARY KEY,
      email       text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN NOINHERIT;
      END IF;
    END $$;
  `);

  const adapter: MigrationRunnerAdapter = {
    async exec(sqlText: string): Promise<void> {
      await pg.exec(sqlText);
    },
    async query<T = unknown>(
      sqlText: string,
      params?: ReadonlyArray<unknown>,
    ): Promise<T[]> {
      const result = await pg.query<T>(sqlText, params ? [...params] : undefined);
      return result.rows;
    },
  };

  const applied = await applyMigrations(adapter);
  log.info({ applied }, 'db.dev.migrations_applied');

  const db = drizzle(pg, { schema });

  // Idempotent seed. Cheap on every boot because of ON CONFLICT — keeps
  // local DB always in a usable demo state without a manual `db:seed`.
  await runAdmin(db, async (tx) => {
    await seedDatabase(tx);
  });
  log.info('db.dev.seed_done');

  return { pg, db };
}

/** Close the dev pglite. Used by long-lived scripts and tests. */
export async function closeDevDb(): Promise<void> {
  if (_devInstance) {
    await _devInstance.pg.close();
    _devInstance = null;
    _devBootPromise = null;
  }
}
