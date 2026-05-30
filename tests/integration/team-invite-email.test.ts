import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import { invitations, organizations, plans, users } from '../../lib/db/schema';
import {
  _resetEmailDbDepsForTests,
  _setEmailDbDepsForTests,
} from '../../lib/emails/client';
import { _resetFlagReaderForTests, _setFlagReaderForTests } from '../../lib/flags';
import { _setInngestEmitForTests } from '../../lib/inngest/client';
import { PLANS } from '../../lib/plans/plans';
import { createInvitations, type InviteDeps } from '../../lib/team/invite';
import { incrementUsage, readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C45 — team invite through C44 Email + Inngest, real consumer. Runs against
 * pglite (real RLS) with the Resend send + email_log writes mocked via seams:
 * ZERO network. Exercises the seats gate (PLAN_LIMIT_REACHED), invitation row
 * creation, and the `email.send` Inngest emit (one per invite) carrying the
 * typed `team_invite` payload in the org's locale.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-d45e00000001';
const orgInvite = '46444444-4444-4444-8450-a00000000001';
const orgSeats = '46444444-4444-4444-8450-b00000000002';
const inviter = '57555555-5555-4555-8550-a00000000001';

const STANDARD_USERS_CAP = PLANS.standard.limits.users;

const emitted: Array<{ name: string; data: Record<string, unknown> }> = [];

let deps: InviteDeps;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    await tx.insert(organizations).values([
      { id: orgInvite, name: 'Equipo Uno', slug: 'equipo-uno', planId, locale: 'es' },
      { id: orgSeats, name: 'Equipo Lleno', slug: 'equipo-lleno', planId, locale: 'es' },
    ]);
    await tx.insert(users).values({ id: inviter, email: 'carlos@inv.test', name: 'Carlos' });
  });

  // email_log writes → pglite admin; Resend send is never reached (emit path).
  _setEmailDbDepsForTests((fn) => runAdmin(fixture.db, fn));
  // Capture the email.send Inngest event (durable path) without a wire.
  _setInngestEmitForTests(async (name, data) => {
    emitted.push({ name, data: data as Record<string, unknown> });
  });
  // Flags OFF (only consulted on the inline fallback, which the emit seam skips).
  _setFlagReaderForTests(() => Promise.resolve('off'));

  deps = {
    asUser: <T>(ctx: { orgId: string; userId: string }, fn: (tx: AnyPgTx) => Promise<T>) =>
      runAs(fixture.db, ctx, fn),
    asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  };
}, 60_000);

afterAll(async () => {
  _resetEmailDbDepsForTests();
  _resetFlagReaderForTests();
  _setInngestEmitForTests(null);
  await fixture.dispose();
});

beforeEach(() => {
  emitted.length = 0;
});

describe('createInvitations — happy path', () => {
  it('creates rows, bumps users, and emits one team_invite email.send per invite (es locale)', async () => {
    const before = await runAdmin<number>(fixture.db, (tx) => readUsage(tx, orgInvite, 'users'));

    const result = await createInvitations(
      {
        orgId: orgInvite,
        userId: inviter,
        inviterName: 'Carlos',
        invites: [
          { email: 'ana@dest.test', role: 'manager' },
          { email: 'beto@dest.test', role: 'agent' },
        ],
        planCode: 'standard',
      },
      deps,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.count).toBe(2);
      expect(result.data.pendingTotal).toBe(2);
    }

    // Invitation rows persisted, org-scoped.
    const rows = await runAdmin<Array<{ email: string; role: string; organizationId: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            email: invitations.email,
            role: invitations.role,
            organizationId: invitations.organizationId,
          })
          .from(invitations)
          .where(eq(invitations.organizationId, orgInvite)),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.organizationId === orgInvite)).toBe(true);

    // users counter bumped by 2 (pending invites consume seats).
    const after = await runAdmin<number>(fixture.db, (tx) => readUsage(tx, orgInvite, 'users'));
    expect(after - before).toBe(2);

    // One email.send per invite, typed team_invite payload, org locale.
    const sends = emitted.filter((e) => e.name === 'email.send');
    expect(sends).toHaveLength(2);
    for (const s of sends) {
      expect(s.data.template).toBe('team_invite');
      expect(s.data.locale).toBe('es');
      expect(s.data.orgId).toBe(orgInvite);
      const payload = s.data.payload as Record<string, unknown>;
      expect(payload.orgName).toBe('Equipo Uno');
      expect(payload.inviterName).toBe('Carlos');
      expect(String(payload.acceptUrl)).toContain('/auth/accept/');
    }
    expect(sends.map((s) => s.data.to).sort()).toEqual(['ana@dest.test', 'beto@dest.test']);
  });
});

describe('createInvitations — seats gate', () => {
  it('rejects with PLAN_LIMIT_REACHED and sends nothing when over the users cap', async () => {
    // Pin the counter one below the cap so a 2-invite batch overflows.
    await runAdmin(fixture.db, (tx) =>
      incrementUsage(tx, orgSeats, 'users', STANDARD_USERS_CAP - 1),
    );

    const result = await createInvitations(
      {
        orgId: orgSeats,
        userId: inviter,
        inviterName: 'Carlos',
        invites: [
          { email: 'x@dest.test', role: 'agent' },
          { email: 'y@dest.test', role: 'agent' },
        ],
        planCode: 'standard',
      },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLAN_LIMIT_REACHED');
      expect(result.error.meta).toMatchObject({ cap: STANDARD_USERS_CAP });
    }

    // No rows, no emails, counter unchanged.
    const rows = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: invitations.id }).from(invitations).where(eq(invitations.organizationId, orgSeats)),
    );
    expect(rows).toHaveLength(0);
    expect(emitted.filter((e) => e.name === 'email.send')).toHaveLength(0);
    const counter = await runAdmin<number>(fixture.db, (tx) => readUsage(tx, orgSeats, 'users'));
    expect(counter).toBe(STANDARD_USERS_CAP - 1);
  });
});
