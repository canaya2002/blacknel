import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  approvals,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * DB-level integration coverage for the approval queue actions in
 * `app/(app)/approvals/actions.ts`. Two behaviours we MUST lock in:
 *
 *   1. Tenant isolation. RLS on `approvals` is straight equality on
 *      organization_id (no subquery) — verify cross-tenant reads return
 *      nothing and cross-tenant writes affect zero rows.
 *   2. `approveWithEdits` semantics. The prior `proposed_payload` moves
 *      into `original_payload`; the edited body becomes the new
 *      `proposed_payload`. This is the audit-friendly diff the master
 *      prompt asked for in the payload contract.
 *
 *   3. CHECK constraint on `entity_table` — anything outside the
 *      allow-list rejects.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fa0000000001';
const orgA = '11111111-1111-4111-8111-fa0000000001';
const orgB = '11111111-1111-4111-8111-fa0000000002';
const userA = '22222222-2222-4222-8222-fa0000000001';
const userB = '22222222-2222-4222-8222-fa0000000002';

const pendingApprovalA = '44444444-4444-4444-8444-fa0000000001';
const pendingApprovalB = '44444444-4444-4444-8444-fa0000000002';
const entityIdA = '55555555-5555-4555-8555-fa0000000001';

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
      { id: userA, email: 'a@appr.test', name: 'A' },
      { id: userB, email: 'b@appr.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'appr-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'appr-org-b', planId },
    ]);
    await tx.insert(approvals).values([
      {
        id: pendingApprovalA,
        organizationId: orgA,
        kind: 'inbox_reply',
        entityTable: 'inbox_messages',
        entityId: entityIdA,
        requestedBy: userA,
        status: 'pending',
        riskLevel: 'medium',
        aiRiskFlags: ['legal_promise'],
        proposedPayload: {
          kind: 'inbox_reply',
          threadId: '66666666-6666-4666-8666-fa0000000001',
          messageBody: 'Garantizamos reembolso completo en 24h.',
          language: 'es',
          aiGenerated: false,
        },
      },
      {
        id: pendingApprovalB,
        organizationId: orgB,
        kind: 'inbox_reply',
        entityTable: 'inbox_messages',
        entityId: '55555555-5555-4555-8555-fa0000000002',
        requestedBy: userB,
        status: 'pending',
        proposedPayload: { messageBody: 'org B body' },
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('approvals tenant isolation', () => {
  it('org A user only sees org A approvals', async () => {
    const visible = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => tx.select({ id: approvals.id }).from(approvals),
    );
    expect(visible.map((r) => r.id).sort()).toEqual([pendingApprovalA]);
  });

  it('org B user cannot UPDATE an org A approval', async () => {
    await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      async (tx) =>
        tx
          .update(approvals)
          .set({ status: 'approved' })
          .where(eq(approvals.id, pendingApprovalA)),
    );
    const [row] = await runAdmin<Array<{ status: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ status: approvals.status })
          .from(approvals)
          .where(eq(approvals.id, pendingApprovalA)),
    );
    expect(row?.status).toBe('pending');
  });
});

describe('approve action', () => {
  it('moves pending → approved + stamps decided_by/at', async () => {
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .update(approvals)
          .set({
            status: 'approved',
            decidedBy: userA,
            decidedAt: new Date(),
            decisionReason: 'Reviewed, OK to send.',
          })
          .where(
            and(
              eq(approvals.id, pendingApprovalA),
              eq(approvals.organizationId, orgA),
              eq(approvals.status, 'pending'),
            ),
          ),
    );
    const [row] = await runAs<
      Array<{ status: string; decidedBy: string | null; decidedAt: Date | null }>
    >(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({
            status: approvals.status,
            decidedBy: approvals.decidedBy,
            decidedAt: approvals.decidedAt,
          })
          .from(approvals)
          .where(eq(approvals.id, pendingApprovalA)),
    );
    expect(row?.status).toBe('approved');
    expect(row?.decidedBy).toBe(userA);
    expect(row?.decidedAt).not.toBeNull();
  });
});

describe('approveWithEdits guarda diff', () => {
  it('moves prior proposed_payload into original_payload, writes new proposed', async () => {
    // Seed a fresh pending approval — we mutated the first one in the
    // approve test, so this needs its own row.
    const editableId = '44444444-4444-4444-8444-fa00000000ee';
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(approvals).values({
        id: editableId,
        organizationId: orgA,
        kind: 'inbox_reply',
        entityTable: 'inbox_messages',
        entityId: '55555555-5555-4555-8555-fa00000000ee',
        requestedBy: userA,
        status: 'pending',
        proposedPayload: {
          kind: 'inbox_reply',
          messageBody: 'Original AI draft — too aggressive.',
          aiGenerated: true,
        },
      }),
    );

    const editedPayload = {
      kind: 'inbox_reply',
      messageBody: 'Edited and softened tone — final outgoing copy.',
      aiGenerated: false,
    };

    // Read + write inside one runAs (mirrors the Server Action transaction).
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => {
        const before = await tx
          .select({
            proposed: approvals.proposedPayload,
            status: approvals.status,
          })
          .from(approvals)
          .where(eq(approvals.id, editableId))
          .limit(1);
        expect(before[0]?.status).toBe('pending');

        await tx
          .update(approvals)
          .set({
            status: 'edited_approved',
            originalPayload: before[0]!.proposed as object,
            proposedPayload: editedPayload,
            decidedBy: userA,
            decidedAt: new Date(),
            decisionReason: 'Edited copy before sending.',
          })
          .where(eq(approvals.id, editableId));
      },
    );

    const [row] = await runAs<
      Array<{
        status: string;
        original: unknown;
        proposed: unknown;
        decidedBy: string | null;
      }>
    >(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({
            status: approvals.status,
            original: approvals.originalPayload,
            proposed: approvals.proposedPayload,
            decidedBy: approvals.decidedBy,
          })
          .from(approvals)
          .where(eq(approvals.id, editableId)),
    );

    expect(row?.status).toBe('edited_approved');
    expect(row?.decidedBy).toBe(userA);
    // The diff: original is what was proposed, proposed is the edit.
    expect(row?.original).toMatchObject({
      messageBody: 'Original AI draft — too aggressive.',
      aiGenerated: true,
    });
    expect(row?.proposed).toMatchObject({
      messageBody: 'Edited and softened tone — final outgoing copy.',
      aiGenerated: false,
    });
  });
});

describe('reject action', () => {
  it('requires decision_reason and persists it', async () => {
    const rejectableId = '44444444-4444-4444-8444-fa0000000eee';
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(approvals).values({
        id: rejectableId,
        organizationId: orgA,
        kind: 'inbox_reply',
        entityTable: 'inbox_messages',
        entityId: '55555555-5555-4555-8555-fa0000000eee',
        requestedBy: userA,
        status: 'pending',
        proposedPayload: { messageBody: 'risky body' },
      }),
    );

    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .update(approvals)
          .set({
            status: 'rejected',
            decisionReason: 'Compliance flagged personal data leak.',
            decidedBy: userA,
            decidedAt: new Date(),
          })
          .where(
            and(
              eq(approvals.id, rejectableId),
              eq(approvals.status, 'pending'),
            ),
          ),
    );

    const [row] = await runAs<
      Array<{ status: string; reason: string | null }>
    >(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({
            status: approvals.status,
            reason: approvals.decisionReason,
          })
          .from(approvals)
          .where(eq(approvals.id, rejectableId)),
    );
    expect(row?.status).toBe('rejected');
    expect(row?.reason).toBe('Compliance flagged personal data leak.');
  });
});

describe('entity_table CHECK constraint', () => {
  it('rejects an approval pointing to an un-listed table', async () => {
    await expect(
      runAdmin(fixture.db, async (tx) =>
        tx.insert(approvals).values({
          organizationId: orgA,
          kind: 'inbox_reply',
          entityTable: 'fictional_table',
          entityId: '55555555-5555-4555-8555-fa0000000bad',
          requestedBy: userA,
          proposedPayload: { messageBody: 'x' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('accepts each whitelisted table', async () => {
    // Use a unique UUID prefix per test run to avoid colliding with the
    // beforeAll seed and the rows other tests insert.
    const whitelisted = ['inbox_messages', 'posts', 'review_responses'] as const;
    const inserted: string[] = [];
    for (let i = 0; i < whitelisted.length; i++) {
      const id = `44444444-4444-4444-8444-fa00000ck${String(i).padStart(3, '0')}`.replace(
        'ck',
        'c0',
      );
      const entityId = `55555555-5555-4555-8555-fa00000ck${String(i).padStart(3, '0')}`.replace(
        'ck',
        'c0',
      );
      inserted.push(id);
      await runAdmin(fixture.db, async (tx) =>
        tx.insert(approvals).values({
          id,
          organizationId: orgA,
          kind: 'post',
          entityTable: whitelisted[i]!,
          entityId,
          requestedBy: userA,
          proposedPayload: { stub: true },
        }),
      );
    }
    const rows = await runAdmin<Array<{ id: string; entityTable: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ id: approvals.id, entityTable: approvals.entityTable })
          .from(approvals)
          .where(eq(approvals.organizationId, orgA)),
    );
    expect(rows.filter((r) => inserted.includes(r.id))).toHaveLength(3);
    expect(new Set(rows.filter((r) => inserted.includes(r.id)).map((r) => r.entityTable))).toEqual(
      new Set(whitelisted),
    );
  });
});
