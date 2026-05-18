import { sql } from 'drizzle-orm';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { z } from 'zod';

import { env } from '../env';
import type { Role } from '../permissions/roles';

import * as schema from './schema';

/**
 * RLS in Blacknel works by:
 *
 *   1. The Postgres role we connect as. Migrations create two roles:
 *      `authenticated` (no superuser, no BYPASSRLS) and `service_role`
 *      (BYPASSRLS, all privileges). The connection itself is as the
 *      Supabase `postgres` role (or pglite's bundled postgres superuser
 *      in dev), which is a superuser — so by default RLS is bypassed.
 *      `SET LOCAL ROLE <name>` inside a transaction changes which role
 *      evaluates policies for that transaction only.
 *
 *   2. Four session-local config values that policies can read:
 *
 *        - `app.current_org_id`         → tenant filter (Phase 1).
 *        - `app.current_user_id`        → identity filter (Phase 1).
 *        - `app.current_user_role`      → Blacknel role (Phase 11 / C42b).
 *                                          Empty string if caller did not
 *                                          pass `role` to `dbAs`.
 *        - `app.current_custom_role_id` → optional custom-role overlay
 *                                          (Phase 11 / C42b). Empty string
 *                                          if absent.
 *
 *      Policies pull them via `current_setting('app.current_org_id', true)::uuid`.
 *      The `true` second arg returns NULL instead of erroring when the
 *      setting was never set — so a forgotten `dbAs` call sees zero rows
 *      instead of crashing. Fail-closed.
 *
 *      The two C42b vars are **inert** until C42c lands dynamic RLS
 *      policies on `posts`, `subscriptions`, `audit_events`, and
 *      `custom_roles`. Until then they are unread; setting them is
 *      ~0.05 ms of overhead per transaction.
 *
 * Two ways to run a transaction:
 *
 *   - `dbAs(ctx, fn)`    → role=authenticated, vars set. RLS enforced.
 *   - `dbAdmin(fn)`      → role=service_role. RLS bypassed. Use sparingly.
 *
 * Runtime selection (read at first `getRawDb()` call):
 *
 *   - `BLACKNEL_USE_MOCKS=true` (default in dev) → pglite, FS-persisted
 *     at `.blacknel/pglite-data/`. Migrations + seed applied on boot.
 *   - `BLACKNEL_USE_MOCKS=false` + `DATABASE_URL=…` → postgres-js. This
 *     is the Phase 11 cutover path (Supabase) and also how the live RLS
 *     test runs.
 *   - `NODE_ENV=test` with mocks on → refuses. Tests must inject their
 *     own pglite via `tests/helpers/test-db.ts` so each run is fresh.
 */

const uuidSchema = z.string().uuid();

/**
 * Loose Drizzle Pg shape — both `drizzle-orm/postgres-js` and
 * `drizzle-orm/pglite` adapters produce structurally compatible runtime
 * objects with `transaction()`. We type loosely on purpose so the same
 * wrappers work in production and in tests.
 */
// FIXME(blacknel): tipar tx correctamente cuando drizzle-orm
// unifique tipos entre postgres-js y pglite.
// Tracking: TODO.md#dbas-tx-type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgDb = any;
// FIXME(blacknel): tipar tx correctamente cuando drizzle-orm
// unifique tipos entre postgres-js y pglite.
// Tracking: TODO.md#dbas-tx-type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgTx = any;

/**
 * Authenticated transaction context. `orgId` and `userId` are required
 * (Phase 1 invariant). `role` and `customRoleId` are Phase 11 / C42b
 * additions — optional, accepted now so the call sites that build a
 * `Session`-shaped object can pass it straight through. Currently inert
 * (no policy reads them); C42c flips that for the four critical tables.
 */
export interface RunAsCtx {
  orgId: string;
  userId: string;
  role?: Role;
  customRoleId?: string | null;
}

/**
 * Run `fn` inside a transaction as an authenticated user. Sets the
 * session role and the org / user context that RLS policies read.
 *
 * `orgId`, `userId`, and (when provided) `customRoleId` are validated
 * as UUIDs before any SQL runs. `role` is type-narrowed to the `Role`
 * enum by TypeScript — no runtime validation needed for it.
 */
export async function runAs<T>(
  db: AnyPgDb,
  ctx: RunAsCtx,
  fn: (tx: AnyPgTx) => Promise<T>,
): Promise<T> {
  uuidSchema.parse(ctx.orgId);
  uuidSchema.parse(ctx.userId);
  if (ctx.customRoleId) uuidSchema.parse(ctx.customRoleId);
  return db.transaction(async (tx: AnyPgTx) => {
    await tx.execute(sql.raw('SET LOCAL ROLE authenticated'));
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${ctx.orgId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`);
    // Phase 11 / C42b — empty string when role/customRoleId not passed.
    // Read by C42c dynamic policies; until then, inert.
    await tx.execute(sql`SELECT set_config('app.current_user_role', ${ctx.role ?? ''}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_custom_role_id', ${ctx.customRoleId ?? ''}, true)`);
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
// Runtime singleton (production: postgres-js / dev: pglite)
// ---------------------------------------------------------------------------

let _rawDb: AnyPgDb | null = null;
let _prodSqlClient: ReturnType<typeof postgres> | null = null;

/**
 * Resolve the active runtime Drizzle instance. Async because the dev
 * runtime needs to spin up pglite + apply migrations + seed on first
 * boot.
 */
export async function getRawDb(): Promise<AnyPgDb> {
  if (_rawDb) return _rawDb;

  // Explicit production / live-test path. Used when caller opts out
  // of mocks AND provides a real DATABASE_URL — Phase 11 production
  // and `rls.live.test.ts`.
  if (!env.BLACKNEL_USE_MOCKS && env.DATABASE_URL) {
    _prodSqlClient = postgres(env.DATABASE_URL, { prepare: false });
    _rawDb = drizzlePostgres(_prodSqlClient, { schema });
    return _rawDb;
  }

  // Phase-11-only error: mocks off but no DATABASE_URL configured.
  if (!env.BLACKNEL_USE_MOCKS && !env.DATABASE_URL) {
    throw new Error(
      'BLACKNEL_USE_MOCKS=false requires DATABASE_URL. Set it in .env.local or flip BLACKNEL_USE_MOCKS back on.',
    );
  }

  // Tests must inject their own db. The fixture in tests/helpers/test-db.ts
  // builds a fresh in-memory pglite per run — sharing the dev singleton
  // would pollute the filesystem-persisted dev DB.
  if (env.NODE_ENV === 'test') {
    throw new Error(
      'Do not call getRawDb() from tests. Pass an explicit Drizzle instance from ' +
        'createTestDb() to runAs() / runAdmin() instead.',
    );
  }

  // Default path: pglite with FS persistence at `.blacknel/pglite-data/`.
  // Migrations + seed applied on first boot. Loaded lazily so test runs
  // never trigger the file-backed pglite.
  const { getDevDb } = await import('./dev-runtime');
  _rawDb = await getDevDb();
  return _rawDb;
}

/** Close any open underlying connection. Safe to call when none is open. */
export async function closeProdDb(): Promise<void> {
  if (_prodSqlClient) {
    await _prodSqlClient.end({ timeout: 5 });
    _prodSqlClient = null;
  }
  _rawDb = null;
}

/**
 * Public API matching the project spec: `dbAs({orgId, userId, role?, customRoleId?}, fn)`.
 * Resolves the runtime db on first call and delegates to `runAs`.
 *
 * Phase 11 / C42b: ctx accepts optional `role` + `customRoleId`.
 * Backward-compatible — existing callers that pass `{orgId, userId}` keep
 * working; the new session vars get set to empty strings. New code (and
 * callers touched by C42c) should pass `role: session.role` (and
 * `customRoleId: session.customRoleId` when applicable). A `Session`
 * object is structurally compatible — `dbAs(session, fn)` works directly.
 */
export async function dbAs<T>(
  ctx: RunAsCtx,
  fn: (tx: AnyPgTx) => Promise<T>,
): Promise<T> {
  const db = await getRawDb();
  return runAs(db, ctx, fn);
}

/**
 * Public API matching the project spec: `dbAdmin(fn)`. Resolves the
 * runtime db on first call and delegates to `runAdmin`.
 *
 * AUDIT EVERY CALLER. RLS bypass is a tenant-isolation escape hatch.
 */
export async function dbAdmin<T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> {
  const db = await getRawDb();
  return runAdmin(db, fn);
}

export { schema };
