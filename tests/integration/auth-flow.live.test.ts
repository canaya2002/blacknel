/**
 * LIVE auth-flow — runs against the real Supabase project at `DATABASE_URL`.
 *
 * Phase 11 / Commit 42a. Smoke for the auth cutover: verifies that the
 * `add_org_claims` Custom Access Token Hook (configured in PASO 0 of the
 * C42 setup) returns the expected `org_id` / `role` / `custom_role_id`
 * for a known seeded user, and that `claimsToSession()` projects the
 * payload into Blacknel's `Session` shape end-to-end.
 *
 * MANUAL ONLY. Skipped by default; runs only when both of:
 *
 *   BLACKNEL_LIVE_TEST=true
 *   DATABASE_URL=postgres://...
 *
 * are set. CI never sets the flag.
 *
 * # What this does NOT cover
 *
 * The full browser-click-link flow is intentionally out of scope —
 * automating it requires a real inbox + a headless browser. The
 * operator smoke for that lives in `doc/runbooks/staging-environment.md`
 * (manual: sign up with your own email at `/login` under flag=real,
 * confirm the magic link works, the redirect lands on `/dashboard`).
 *
 * What we DO cover: the SQL hook itself + the TS projection. If either
 * regresses, this test fails before the operator sees an empty
 * `getSession()` in production.
 *
 * Invocation: see `doc/runbooks/staging-environment.md`.
 */
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { closeProdDb, dbAdmin } from '../../lib/db/client';
import {
  claimsToSession,
  type SupabaseAccessTokenClaims,
} from '../../lib/auth/supabase-claims';
import { SEED_IDS } from '../../lib/db/seed';
import { isLiveEnabled } from '../helpers/live-test-gate';

const describeLive = isLiveEnabled() ? describe : describe.skip;

interface HookResult {
  claims: SupabaseAccessTokenClaims;
}

describeLive('auth-flow LIVE (add_org_claims hook + claimsToSession)', () => {
  afterAll(async () => {
    await closeProdDb();
  });

  it('add_org_claims emits org_id + role for the demo owner', async () => {
    const rows = await dbAdmin<Array<{ result: HookResult }>>(async (tx) =>
      tx.execute(sql`
        SELECT public.add_org_claims(
          jsonb_build_object(
            'user_id', ${SEED_IDS.user.owner}::uuid,
            'claims',  '{}'::jsonb
          )
        ) AS result
      `),
    );

    const result = rows[0]?.result;
    expect(result).toBeDefined();
    expect(result?.claims).toBeDefined();
    expect(result?.claims.org_id).toBe(SEED_IDS.org.demo);
    expect(result?.claims.role).toBe('owner');
    expect(result?.claims.custom_role_id).toBeNull();
  });

  it('add_org_claims emits the correct role for each demo member', async () => {
    const expectedRoles = [
      { userId: SEED_IDS.user.owner, role: 'owner' },
      { userId: SEED_IDS.user.admin1, role: 'admin' },
      { userId: SEED_IDS.user.manager, role: 'manager' },
      { userId: SEED_IDS.user.agent, role: 'agent' },
      { userId: SEED_IDS.user.viewer, role: 'viewer' },
    ] as const;

    for (const { userId, role } of expectedRoles) {
      const rows = await dbAdmin<Array<{ result: HookResult }>>(async (tx) =>
        tx.execute(sql`
          SELECT public.add_org_claims(
            jsonb_build_object(
              'user_id', ${userId}::uuid,
              'claims',  '{}'::jsonb
            )
          ) AS result
        `),
      );
      expect(rows[0]?.result.claims.role).toBe(role);
      expect(rows[0]?.result.claims.org_id).toBe(SEED_IDS.org.demo);
    }
  });

  it('add_org_claims returns null claims for an unknown user', async () => {
    const phantomId = '9e9e9e9e-0099-4000-8000-000000000001';

    const rows = await dbAdmin<Array<{ result: HookResult }>>(async (tx) =>
      tx.execute(sql`
        SELECT public.add_org_claims(
          jsonb_build_object(
            'user_id', ${phantomId}::uuid,
            'claims',  '{}'::jsonb
          )
        ) AS result
      `),
    );

    const result = rows[0]?.result;
    expect(result?.claims.org_id).toBeNull();
    expect(result?.claims.role).toBeNull();
    expect(result?.claims.custom_role_id).toBeNull();
  });

  it('claimsToSession projects a hook-emitted payload into Session', async () => {
    const rows = await dbAdmin<Array<{ result: HookResult }>>(async (tx) =>
      tx.execute(sql`
        SELECT public.add_org_claims(
          jsonb_build_object(
            'user_id', ${SEED_IDS.user.owner}::uuid,
            'claims',  jsonb_build_object(
              'sub',   ${SEED_IDS.user.owner}::text,
              'email', 'owner@blacknel.demo'
            )
          )
        ) AS result
      `),
    );

    const claims = rows[0]!.result.claims;
    const session = claimsToSession(claims, 'Demo Owner');

    expect(session).not.toBeNull();
    expect(session?.userId).toBe(SEED_IDS.user.owner);
    expect(session?.orgId).toBe(SEED_IDS.org.demo);
    expect(session?.role).toBe('owner');
    expect(session?.email).toBe('owner@blacknel.demo');
    expect(session?.name).toBe('Demo Owner');
  });

  it('claimsToSession returns null for an org-less hook payload', async () => {
    const phantomId = '9e9e9e9e-0099-4000-8000-000000000002';

    const rows = await dbAdmin<Array<{ result: HookResult }>>(async (tx) =>
      tx.execute(sql`
        SELECT public.add_org_claims(
          jsonb_build_object(
            'user_id', ${phantomId}::uuid,
            'claims',  jsonb_build_object(
              'sub',   ${phantomId}::text,
              'email', 'phantom@blacknel.test'
            )
          )
        ) AS result
      `),
    );

    const session = claimsToSession(rows[0]!.result.claims);
    expect(session).toBeNull();
  });
});
