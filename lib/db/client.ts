import { sql } from 'drizzle-orm';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';

import { env } from '../env';
import * as schema from './schema';

/**
 * RLS in Blacknel works by:
 *
 *   1. The Postgres role we connect as. Migrations create two roles:
 *      `authenticated` (no superuser, no BYPASSRLS) and `service_role`
 *      (BYPASSRLS, all privileges). The connection itself is as the
 *      Supabase `postgres` role, which is a superuser — so by default
 *      RLS is bypassed. `SET LOCAL ROLE <name>` inside a transaction
 *      changes which role evaluates policies for that transaction only.
 *
 *   2. Two session-local config values that every tenant policy reads:
 *
 *        - `app.current_org_id`  → tenant filter
 *        - `app.current_user_id` → identity filter (e.g. read self)
 *
 *      Policies pull them via `current_setting('app.current_org_id', true)::uuid`.
 *      The `true` second arg returns NULL instead of erroring when the
 *      setting was never set — so a forgotten `dbAs` call sees zero rows
 *      instead of crashing. Fail-closed.
 *
 * Two ways to run a transaction:
 *
 *   - `dbAs(ctx, fn)`    → role=authenticated, vars set. RLS enforced.
 *   - `dbAdmin(fn)`      → role=service_role. RLS bypassed. Use sparingly.
 *
 * The "production" wrappers use a singleton postgres-js connection
 * (`env.DATABASE_URL`). For integration tests we run the same logic
 * against a pglite-backed Drizzle instance via `runAs` / `runAdmin`.
 */

const uuidSchema = z.string().uuid();

/**
 * Loose Drizzle Pg shape — both `drizzle-orm/postgres-js` and
 * `drizzle-orm/pglite` adapters produce structurally compatible runtime
 * objects with `transaction()`. We type loosely on purpose so the same
 * wrappers work in production and in tests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgDb = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgTx = any;

/**
 * Run `fn` inside a transaction as an authenticated user. Sets the
 * session role and the org / user context that RLS policies read.
 *
 * `orgId` and `userId` are validated as UUIDs before any SQL runs.
 */
export async function runAs<T>(
  db: AnyPgDb,
  ctx: { orgId: string; userId: string },
  fn: (tx: AnyPgTx) => Promise<T>,
): Promise<T> {
  uuidSchema.parse(ctx.orgId);
  uuidSchema.parse(ctx.userId);
  return db.transaction(async (tx: AnyPgTx) => {
    await tx.execute(sql.raw('SET LOCAL ROLE authenticated'));
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
    return fn(tx);
  });
}

/**
 * Run `fn` inside a transaction with RLS **bypassed** — for migrations,
 * seed scripts, system jobs, and explicit admin operations only.
 *
 * Switches the session role to `service_role` (BYPASSRLS attribute).
 * Every call here is an audited tenant-isolation escape hatch. If you
 * reach for this from a request handler triggered by a user, you are
 * almost certainly doing it wrong — use `runAs` / `dbAs` instead and
 * let the caller's org context filter the query.
 */
export async function runAdmin<T>(
  db: AnyPgDb,
  fn: (tx: AnyPgTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx: AnyPgTx) => {
    await tx.execute(sql.raw('SET LOCAL ROLE service_role'));
    return fn(tx);
  });
}

// ---------------------------------------------------------------------------
// Production singleton
// ---------------------------------------------------------------------------

let _prodRawDb: AnyPgDb | null = null;
let _prodSqlClient: ReturnType<typeof postgres> | null = null;

/**
 * Lazy-initialized postgres-js connection + Drizzle wrapper. Throws if
 * `DATABASE_URL` is missing — keeps import-time side effects nil so
 * pglite-backed tests don't accidentally trip the production path.
 */
export function getRawDb(): AnyPgDb {
  if (_prodRawDb) return _prodRawDb;
  if (!env.DATABASE_URL) {
    throw new Error(
      [
        'DATABASE_URL is not set.',
        'Configure Supabase blacknel-dev in .env.local before using the production db client,',
        'or pass an explicit Drizzle instance to runAs() / runAdmin() (used by integration tests).',
      ].join(' '),
    );
  }
  _prodSqlClient = postgres(env.DATABASE_URL, { prepare: false });
  _prodRawDb = drizzlePostgres(_prodSqlClient, { schema });
  return _prodRawDb;
}

/** Close the production connection pool. Used by long-running scripts. */
export async function closeProdDb(): Promise<void> {
  if (_prodSqlClient) {
    await _prodSqlClient.end({ timeout: 5 });
    _prodSqlClient = null;
    _prodRawDb = null;
  }
}

/**
 * Public API matching the project spec: `dbAs({orgId, userId}, fn)`.
 * Resolves the production raw db on first call and delegates to `runAs`.
 */
export async function dbAs<T>(
  ctx: { orgId: string; userId: string },
  fn: (tx: AnyPgTx) => Promise<T>,
): Promise<T> {
  return runAs(getRawDb(), ctx, fn);
}

/**
 * Public API matching the project spec: `dbAdmin(fn)`. Resolves the
 * production raw db on first call and delegates to `runAdmin`.
 *
 * AUDIT EVERY CALLER. RLS bypass is a tenant-isolation escape hatch.
 */
export async function dbAdmin<T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> {
  return runAdmin(getRawDb(), fn);
}

export { schema };
