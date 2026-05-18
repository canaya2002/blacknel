/**
 * LIVE login-seed listing — runs against the real Postgres at `DATABASE_URL`.
 *
 * Phase 11 / C41. Smoke test for the `/login` Server Component query
 * (`app/(marketing)/login/page.tsx`). Read-only, idempotent, does not
 * insert any rows. Verifies that the demo seed populated `users ⋈
 * organization_members ⋈ organizations` correctly in Supabase staging.
 *
 * MANUAL ONLY. Skipped by default; runs only when both of:
 *
 *   BLACKNEL_LIVE_TEST=true
 *   DATABASE_URL=postgres://...
 *
 * are set. CI does not set the flag, so this file silently skips there.
 *
 * Invocation:
 *
 *   BLACKNEL_LIVE_TEST=true \
 *   BLACKNEL_USE_MOCKS=false \
 *   DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres \
 *   pnpm vitest run tests/integration/login-seed.live.test.ts
 *
 * Pre-requisites: `pnpm db:migrate` + `pnpm db:seed` run successfully
 * against the same DATABASE_URL.
 */
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { closeProdDb, dbAdmin } from '../../lib/db/client';
import {
  organizationMembers,
  organizations as orgsTable,
  users as usersTable,
} from '../../lib/db/schema';
import { env } from '../../lib/env';
import { SEED_IDS } from '../../lib/db/seed';

const LIVE_ENABLED =
  process.env.BLACKNEL_LIVE_TEST === 'true' && Boolean(env.DATABASE_URL);

const describeLive = LIVE_ENABLED ? describe : describe.skip;

interface SeedAccountRow {
  userId: string;
  orgId: string;
  email: string;
  role: string;
}

describeLive('LOGIN seed listing LIVE (against DATABASE_URL)', () => {
  afterAll(async () => {
    await closeProdDb();
  });

  it('returns the full 6-account demo set with the expected role mix', async () => {
    const rows = await dbAdmin<SeedAccountRow[]>(async (tx) =>
      tx
        .select({
          userId: organizationMembers.userId,
          orgId: organizationMembers.organizationId,
          email: usersTable.email,
          role: organizationMembers.role,
        })
        .from(organizationMembers)
        .innerJoin(usersTable, eq(usersTable.id, organizationMembers.userId))
        .innerJoin(orgsTable, eq(orgsTable.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.organizationId, SEED_IDS.org.demo))
        .orderBy(usersTable.email),
    );

    expect(rows.length).toBeGreaterThanOrEqual(6);

    const rolesByEmail = new Map(rows.map((r) => [r.email, r.role]));
    expect(rolesByEmail.get('owner@blacknel.demo')).toBe('owner');
    expect(rolesByEmail.get('admin1@blacknel.demo')).toBe('admin');
    expect(rolesByEmail.get('admin2@blacknel.demo')).toBe('admin');
    expect(rolesByEmail.get('manager@blacknel.demo')).toBe('manager');
    expect(rolesByEmail.get('agent@blacknel.demo')).toBe('agent');
    expect(rolesByEmail.get('viewer@blacknel.demo')).toBe('viewer');

    for (const row of rows) {
      expect(row.orgId).toBe(SEED_IDS.org.demo);
    }
  });
});
