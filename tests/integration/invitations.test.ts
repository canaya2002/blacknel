import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  invitations,
  organizationMembers,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  generateInvitationToken,
  invitationAcceptPath,
  invitationAcceptUrl,
  INVITATION_TTL_MS,
} from '../../lib/invitations/tokens';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-bbbbbbbbbbbb';
const orgId = '11111111-1111-4111-8111-bbbbbbbbbbbb';
const ownerId = '22222222-2222-4222-8222-bbbbbbbbbbbb';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    await tx.insert(users).values({
      id: ownerId,
      email: 'owner@invitations.test',
      name: 'Owner',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Invitations Test Org',
      slug: 'invitations-test',
      planId,
      createdBy: ownerId,
    });
    await tx.insert(organizationMembers).values({
      organizationId: orgId,
      userId: ownerId,
      role: 'owner',
      status: 'active',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('invitation tokens', () => {
  it('generates URL-safe tokens long enough for entropy', () => {
    const token = generateInvitationToken();
    expect(token.length).toBeGreaterThanOrEqual(40);
    // base64url alphabet only
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('builds an accept URL that re-encodes the token only once', () => {
    const token = 'aA_-09';
    expect(invitationAcceptPath(token)).toBe(`/auth/accept/${encodeURIComponent(token)}`);
    expect(invitationAcceptUrl('http://localhost:3000/', token)).toBe(
      `http://localhost:3000/auth/accept/${encodeURIComponent(token)}`,
    );
  });
});

describe('invitations: create, list, accept, expire', () => {
  it('creates and lists pending invitations', async () => {
    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(invitations).values({
        organizationId: orgId,
        email: 'invited@invitations.test',
        role: 'admin',
        token,
        expiresAt,
        invitedBy: ownerId,
      });
    });
    const pending = await runAdmin<Array<{ token: string }>>(fixture.db, async (tx) =>
      tx
        .select()
        .from(invitations)
        .where(
          and(eq(invitations.organizationId, orgId), gt(invitations.expiresAt, new Date())),
        ),
    );
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0]?.token).toBe(token);
  });

  it('marks acceptance idempotently via acceptedAt + acceptedBy', async () => {
    const token = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const acceptingUserId = '33333333-3333-4333-8333-bbbbbbbbbbbb';

    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(users).values({
        id: acceptingUserId,
        email: 'accept@invitations.test',
      });
      await tx.insert(invitations).values({
        organizationId: orgId,
        email: 'accept@invitations.test',
        role: 'manager',
        token,
        expiresAt,
        invitedBy: ownerId,
      });
    });

    // First accept call.
    const first = await runAdmin(fixture.db, async (tx) =>
      tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedBy: acceptingUserId })
        .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id }),
    );
    expect(first.length).toBe(1);

    // Second accept call should be a no-op because acceptedAt is set.
    const second = await runAdmin(fixture.db, async (tx) =>
      tx
        .update(invitations)
        .set({ acceptedAt: new Date(), acceptedBy: acceptingUserId })
        .where(and(eq(invitations.token, token), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id }),
    );
    expect(second.length).toBe(0);
  });

  it('expired invitations are filtered from the pending list', async () => {
    const expiredToken = generateInvitationToken();
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(invitations).values({
        organizationId: orgId,
        email: 'expired@invitations.test',
        role: 'viewer',
        token: expiredToken,
        expiresAt: new Date(Date.now() - 1000),
        invitedBy: ownerId,
      });
    });

    const pending = await runAdmin<Array<{ token: string }>>(fixture.db, async (tx) =>
      tx
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, orgId),
            gt(invitations.expiresAt, new Date()),
          ),
        ),
    );
    expect(pending.find((p) => p.token === expiredToken)).toBeUndefined();

    const expired = await runAdmin<Array<{ token: string }>>(fixture.db, async (tx) =>
      tx
        .select({ token: invitations.token })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, orgId),
            lt(invitations.expiresAt, new Date()),
          ),
        ),
    );
    expect(expired.find((p) => p.token === expiredToken)).toBeDefined();
  });
});
