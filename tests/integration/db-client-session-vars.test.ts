import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAs } from '../../lib/db/client';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 11 / Commit 42b — session-var plumbing tests.
 *
 * Verifies that `runAs()` sets all four `app.current_*` session
 * variables inside its transaction, both when the caller passes
 * `role`/`customRoleId` and when they omit them (backward-compat
 * with the ~78 existing callers that still pass only `{orgId, userId}`).
 *
 * Migration 0022 (`app_session_vars()`) is exercised here — it's the
 * canonical way to read back all four vars in one round-trip.
 *
 * Runs against a fresh in-memory pglite from `createTestDb()`, no
 * external DB required.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-220000000001';
const CUSTOM_ROLE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface SessionVars {
  org_id: string;
  user_id: string;
  user_role: string;
  custom_role_id: string;
}

interface SessionVarsRow {
  v: SessionVars;
}

/**
 * Drizzle's `tx.execute(sql\`...\`)` return shape differs across adapters:
 *
 *   - pglite (this test)   → `{ rows: T[], affectedRows, fields }`
 *   - postgres-js (live)   → `T[]` directly
 *
 * Normalise so the helper works for both, in case a future live variant
 * of this test points at Supabase.
 */
async function readSessionVars(
  tx: Parameters<Parameters<typeof runAs>[2]>[0],
): Promise<SessionVars> {
  const result = await tx.execute(sql`SELECT public.app_session_vars() AS v`);
  const rows: ReadonlyArray<SessionVarsRow> = Array.isArray(result)
    ? (result as unknown as ReadonlyArray<SessionVarsRow>)
    : ((result as unknown as { rows: ReadonlyArray<SessionVarsRow> }).rows ?? []);
  return rows[0]!.v;
}

describe('runAs session vars (Phase 11 / C42b plumbing)', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await createTestDb();
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it('sets all four vars when role + customRoleId provided', async () => {
    const vars = await runAs(
      testDb.db,
      {
        orgId: ORG,
        userId: USER,
        role: 'owner',
        customRoleId: CUSTOM_ROLE,
      },
      readSessionVars,
    );

    expect(vars.org_id).toBe(ORG);
    expect(vars.user_id).toBe(USER);
    expect(vars.user_role).toBe('owner');
    expect(vars.custom_role_id).toBe(CUSTOM_ROLE);
  });

  it('omits role + customRoleId → empty strings (backward-compat)', async () => {
    const vars = await runAs(
      testDb.db,
      { orgId: ORG, userId: USER },
      readSessionVars,
    );

    expect(vars.org_id).toBe(ORG);
    expect(vars.user_id).toBe(USER);
    expect(vars.user_role).toBe('');
    expect(vars.custom_role_id).toBe('');
  });

  it('passes role without customRoleId → role set, custom empty', async () => {
    const vars = await runAs(
      testDb.db,
      { orgId: ORG, userId: USER, role: 'manager' },
      readSessionVars,
    );

    expect(vars.user_role).toBe('manager');
    expect(vars.custom_role_id).toBe('');
  });

  it('treats explicit customRoleId=null as empty (not the literal "null")', async () => {
    const vars = await runAs(
      testDb.db,
      { orgId: ORG, userId: USER, role: 'agent', customRoleId: null },
      readSessionVars,
    );

    expect(vars.user_role).toBe('agent');
    expect(vars.custom_role_id).toBe('');
  });

  it('vars scope is transaction-local — each runAs is isolated', async () => {
    // First transaction writes "owner".
    const first = await runAs(
      testDb.db,
      { orgId: ORG, userId: USER, role: 'owner' },
      readSessionVars,
    );
    expect(first.user_role).toBe('owner');

    // Second transaction without role → empty. Confirms `SET LOCAL`
    // truly is local; no leak across runAs invocations.
    const second = await runAs(
      testDb.db,
      { orgId: ORG, userId: USER },
      readSessionVars,
    );
    expect(second.user_role).toBe('');
  });

  it('rejects an invalid customRoleId before opening a transaction', async () => {
    await expect(
      runAs(
        testDb.db,
        {
          orgId: ORG,
          userId: USER,
          role: 'owner',
          customRoleId: 'not-a-uuid',
        },
        async () => 'unreachable',
      ),
    ).rejects.toThrow();
  });
});
