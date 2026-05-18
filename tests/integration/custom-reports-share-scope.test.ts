import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  customReports,
  organizationMembers,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { listCustomReportsForUserWithTx } from '../../lib/custom-reports/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 39 — share scope semantics end-to-end.
 *
 * Confirms the 3-state share scope (D-39-4):
 *   - `private`         → creator only.
 *   - `org_visible`     → any org member.
 *   - `specific_users`  → users in `shared_with[]` ∪ creator.
 */

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-fff000039201';
const orgId = '11111111-1111-4111-8111-fff000039201';
const owner = '22222222-2222-4222-8222-fff000039201';
const otherUser = '22222222-2222-4222-8222-fff000039202';
const allowedUser = '22222222-2222-4222-8222-fff000039203';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values([
      { id: owner, email: 'share-owner@blacknel.test', name: 'Owner' },
      { id: otherUser, email: 'share-other@blacknel.test', name: 'Other' },
      { id: allowedUser, email: 'share-allowed@blacknel.test', name: 'Allowed' },
    ]);
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Share Org',
      slug: 'share-org',
      planId,
    });
    await tx.insert(organizationMembers).values([
      { organizationId: orgId, userId: owner, role: 'admin', status: 'active' },
      { organizationId: orgId, userId: otherUser, role: 'viewer', status: 'active' },
      { organizationId: orgId, userId: allowedUser, role: 'viewer', status: 'active' },
    ]);

    const now = new Date();
    await tx.insert(customReports).values([
      {
        id: '55555555-5555-4555-8555-fff000039201',
        organizationId: orgId,
        name: 'Private to owner',
        status: 'published',
        publishedAt: now,
        shareScope: 'private',
        createdBy: owner,
      },
      {
        id: '55555555-5555-4555-8555-fff000039202',
        organizationId: orgId,
        name: 'Org visible',
        status: 'published',
        publishedAt: now,
        shareScope: 'org_visible',
        createdBy: owner,
      },
      {
        id: '55555555-5555-4555-8555-fff000039203',
        organizationId: orgId,
        name: 'Specific to allowedUser',
        status: 'published',
        publishedAt: now,
        shareScope: 'specific_users',
        sharedWith: [allowedUser],
        createdBy: owner,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('share scope visibility', () => {
  it('owner sees all 3 reports', async () => {
    const rows = await runAs(fixture.db, { orgId, userId: owner }, (tx) =>
      listCustomReportsForUserWithTx(tx, { orgId, userId: owner }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain('55555555-5555-4555-8555-fff000039201');
    expect(ids).toContain('55555555-5555-4555-8555-fff000039202');
    expect(ids).toContain('55555555-5555-4555-8555-fff000039203');
  });

  it('other user only sees org_visible (NOT private, NOT specific allowedUser)', async () => {
    const rows = await runAs(fixture.db, { orgId, userId: otherUser }, (tx) =>
      listCustomReportsForUserWithTx(tx, { orgId, userId: otherUser }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain('55555555-5555-4555-8555-fff000039201');
    expect(ids).toContain('55555555-5555-4555-8555-fff000039202');
    expect(ids).not.toContain('55555555-5555-4555-8555-fff000039203');
  });
});
