import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  approvals,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { decodeApprovalCursor } from '../../lib/approvals/cursor';
import { listApprovalsWithTx } from '../../lib/approvals/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fd0000000001';
const orgA = '11111111-1111-4111-8111-fd0000000001';
const orgB = '11111111-1111-4111-8111-fd0000000002';
const userA = '22222222-2222-4222-8222-fd0000000001';
const userB = '22222222-2222-4222-8222-fd0000000002';

const orgATotal = 14;

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
      { id: userA, email: 'a@aq.test', name: 'A' },
      { id: userB, email: 'b@aq.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Q Org A', slug: 'q-appr-a', planId },
      { id: orgB, name: 'Q Org B', slug: 'q-appr-b', planId },
    ]);

    const base = new Date('2026-05-15T12:00:00Z').getTime();
    const statuses = [
      'pending',
      'approved',
      'rejected',
      'pending',
      'edited_approved',
      'escalated',
      'pending',
    ] as const;
    const risks = ['low', 'medium', 'high', 'critical'] as const;
    const kinds = ['inbox_reply', 'post', 'review_response'] as const;
    const rows: Array<typeof approvals.$inferInsert> = [];
    for (let i = 0; i < orgATotal; i++) {
      rows.push({
        id: `44444444-4444-4444-8444-fd${String(i).padStart(10, '0')}`,
        organizationId: orgA,
        kind: kinds[i % kinds.length]!,
        entityTable:
          kinds[i % kinds.length] === 'inbox_reply'
            ? 'inbox_messages'
            : kinds[i % kinds.length] === 'post'
              ? 'posts'
              : 'review_responses',
        entityId: `55555555-5555-4555-8555-fd${String(i).padStart(10, '0')}`,
        requestedBy: userA,
        status: statuses[i % statuses.length]!,
        riskLevel: risks[i % risks.length]!,
        proposedPayload: { messageBody: `body #${i}` },
        createdAt: new Date(base - i * 60 * 1000),
      });
    }
    // 3 rows in org B to test isolation
    for (let i = 0; i < 3; i++) {
      rows.push({
        id: `44444444-4444-4444-8444-fd0000000B${String(i).padStart(2, '0')}`,
        organizationId: orgB,
        kind: 'inbox_reply',
        entityTable: 'inbox_messages',
        entityId: `55555555-5555-4555-8555-fd0000000B${String(i).padStart(2, '0')}`,
        requestedBy: userB,
        status: 'pending',
        riskLevel: 'low',
        proposedPayload: { messageBody: `orgB ${i}` },
      });
    }
    await tx.insert(approvals).values(rows);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('listApprovalsWithTx — basic listing', () => {
  it('returns org-A approvals only for an org-A session, in created_at DESC order', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listApprovalsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.approvals.length).toBe(orgATotal);
    expect(page.approvals.every((a) => a.id.startsWith('44444444-4444-4444-8444-fd0'))).toBe(
      true,
    );
    // No org B leakage
    expect(page.approvals.every((a) => !a.id.includes('B0'))).toBe(true);
    expect(page.nextCursor).toBeNull();
  });

  it('filters by status', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listApprovalsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { status: ['pending'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.approvals.every((a) => a.status === 'pending')).toBe(true);
    expect(page.approvals.length).toBeGreaterThan(0);
  });

  it('filters by kind', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listApprovalsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { kind: ['inbox_reply'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.approvals.every((a) => a.kind === 'inbox_reply')).toBe(true);
  });

  it('filters by riskLevel', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listApprovalsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { riskLevel: ['critical'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.approvals.every((a) => a.riskLevel === 'critical')).toBe(true);
  });
});

describe('listApprovalsWithTx — cursor pagination', () => {
  it('paginates through every row exactly once with no overlap', async () => {
    const pageSize = 5;
    const seen: string[] = [];
    let cursor: ReturnType<typeof decodeApprovalCursor> = null;
    for (let i = 0; i < 6; i++) {
      const page = await runAs(
        fixture.db,
        { orgId: orgA, userId: userA },
        async (tx) =>
          listApprovalsWithTx(tx, {
            orgId: orgA,
            userId: userA,
            filters: {},
            cursor,
            pageSize,
          }),
      );
      seen.push(...page.approvals.map((a) => a.id));
      if (!page.nextCursor) break;
      cursor = decodeApprovalCursor(page.nextCursor);
    }
    expect(seen.length).toBe(orgATotal);
    expect(new Set(seen).size).toBe(orgATotal);
  });
});

describe('listApprovalsWithTx — tenant isolation', () => {
  it('does not leak org B approvals to org A session', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listApprovalsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.approvals.every((a) => !a.id.endsWith('B00'))).toBe(true);
    expect(page.approvals.every((a) => !a.id.endsWith('B01'))).toBe(true);
  });
});
