import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  approvals,
  auditEvents,
  contactProfiles,
  inboxMessages,
  inboxThreads,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { dispatchApproved } from '../../lib/approvals/dispatch';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Approval dispatcher + decision flow tests.
 *
 * The Server Actions in `app/(app)/approvals/actions.ts` run inside
 * `dbAs` — testing them directly would require synthesising a Next
 * request context vitest can't supply. Instead we test the underlying
 * SQL choreography these actions perform: SELECT FOR UPDATE → dispatch
 * → UPDATE, all inside one `runAs` transaction.
 *
 * What we lock in:
 *
 *   1. Happy path. dispatchInboxReplyApproval reuses the pre-generated
 *      entity_id as the inbox_messages.id and bumps last_message_at.
 *   2. Rollback. If the dispatcher throws, the txn rolls back and
 *      approval.status stays 'pending'.
 *   3. Concurrency. A second decision attempt sees the updated status
 *      and bails out (the production code returns APPROVAL_ALREADY_
 *      DECIDED — here we simply observe that the second SELECT shows
 *      the post-commit state).
 *   4. Edit-approve diff. dispatch with edited payload uses the new
 *      body; status moves to 'edited_approved'; original_payload swap
 *      preserves the diff for audit.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fe0000000001';
const orgA = '11111111-1111-4111-8111-fe0000000001';
const userA = '22222222-2222-4222-8222-fe0000000001';
const userMod = '22222222-2222-4222-8222-fe0000000002';

const threadId = '33333333-3333-4333-8333-fe0000000001';
const danglingThreadId = '33333333-3333-4333-8333-fe000000dead';

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
      { id: userA, email: 'a@flow.test', name: 'A' },
      { id: userMod, email: 'm@flow.test', name: 'Mod' },
    ]);
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Org A',
      slug: 'flow-org-a',
      planId,
    });
    await tx.insert(contactProfiles).values({
      id: 'cccccccc-cccc-4ccc-8ccc-fe0000000001',
      organizationId: orgA,
      platform: 'facebook',
      externalId: 'ext-contact-flow',
      displayName: 'Cliente Flow',
    });
    await tx.insert(inboxThreads).values({
      id: threadId,
      organizationId: orgA,
      platform: 'facebook',
      contactProfileId: 'cccccccc-cccc-4ccc-8ccc-fe0000000001',
      kind: 'dm',
      status: 'open',
      priority: 'normal',
      sentiment: 'neutral',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

async function makeApproval(opts: {
  id: string;
  threadIdInPayload: string;
  body: string;
}): Promise<void> {
  await runAdmin(fixture.db, async (tx) =>
    tx.insert(approvals).values({
      id: opts.id,
      organizationId: orgA,
      kind: 'inbox_reply',
      entityTable: 'inbox_messages',
      entityId: opts.id.replace('44444444', '55555555'), // pre-generated message id
      requestedBy: userA,
      status: 'pending',
      riskLevel: 'medium',
      aiRiskFlags: ['refund_promise'],
      proposedPayload: {
        kind: 'inbox_reply',
        threadId: opts.threadIdInPayload,
        messageBody: opts.body,
        language: 'es',
        aiGenerated: false,
      },
    }),
  );
}

describe('dispatch happy path', () => {
  const approvalId = '44444444-4444-4444-8444-fe0000000001';
  it('inserts inbox_message with the pre-generated entity_id and updates approval', async () => {
    await makeApproval({
      id: approvalId,
      threadIdInPayload: threadId,
      body: 'Reembolso aprobado.',
    });

    await runAs(
      fixture.db,
      { orgId: orgA, userId: userMod },
      async (tx) => {
        // Lock + read
        const rows = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.id, approvalId))
          .for('update');
        const row = rows[0]!;
        expect(row.status).toBe('pending');

        // Dispatch
        const { messageId } = await dispatchApproved(tx, row, userMod);
        expect(messageId).toBe(row.entityId);

        // Mark approved
        await tx
          .update(approvals)
          .set({ status: 'approved', decidedBy: userMod, decidedAt: new Date() })
          .where(eq(approvals.id, row.id));
      },
    );

    // Verify side effects committed.
    const [msg] = await runAdmin<Array<typeof inboxMessages.$inferSelect>>(
      fixture.db,
      async (tx) =>
        tx
          .select()
          .from(inboxMessages)
          .where(eq(inboxMessages.id, approvalId.replace('44444444', '55555555'))),
    );
    expect(msg).toBeDefined();
    expect(msg?.body).toBe('Reembolso aprobado.');
    expect(msg?.threadId).toBe(threadId);
    expect(msg?.authorId).toBe(userMod);

    const [appr] = await runAdmin<Array<typeof approvals.$inferSelect>>(
      fixture.db,
      async (tx) => tx.select().from(approvals).where(eq(approvals.id, approvalId)),
    );
    expect(appr?.status).toBe('approved');
    expect(appr?.decidedBy).toBe(userMod);
  });
});

describe('dispatch rollback', () => {
  const approvalId = '44444444-4444-4444-8444-fe0000000002';
  it('approval stays pending when the dispatcher throws (txn rollback)', async () => {
    await makeApproval({
      id: approvalId,
      threadIdInPayload: danglingThreadId, // thread does not exist
      body: 'should not land',
    });

    await expect(
      runAs(
        fixture.db,
        { orgId: orgA, userId: userMod },
        async (tx) => {
          const rows = await tx
            .select()
            .from(approvals)
            .where(eq(approvals.id, approvalId))
            .for('update');
          const row = rows[0]!;

          // This throws because the referenced thread does not exist —
          // the entire transaction rolls back.
          await dispatchApproved(tx, row, userMod);

          // Should never reach here.
          await tx
            .update(approvals)
            .set({ status: 'approved' })
            .where(eq(approvals.id, row.id));
        },
      ),
    ).rejects.toThrow();

    // Approval still pending — rollback verified.
    const [appr] = await runAdmin<Array<typeof approvals.$inferSelect>>(
      fixture.db,
      async (tx) => tx.select().from(approvals).where(eq(approvals.id, approvalId)),
    );
    expect(appr?.status).toBe('pending');

    // No message produced.
    const msgs = await runAdmin<Array<typeof inboxMessages.$inferSelect>>(
      fixture.db,
      async (tx) =>
        tx
          .select()
          .from(inboxMessages)
          .where(eq(inboxMessages.id, approvalId.replace('44444444', '55555555'))),
    );
    expect(msgs.length).toBe(0);
  });
});

describe('concurrency — second decision sees decided state', () => {
  const approvalId = '44444444-4444-4444-8444-fe0000000003';
  it('first decision wins; subsequent attempts observe non-pending status', async () => {
    await makeApproval({
      id: approvalId,
      threadIdInPayload: threadId,
      body: 'Primer mod decide.',
    });

    // First moderator approves
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userMod },
      async (tx) => {
        const rows = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.id, approvalId))
          .for('update');
        const row = rows[0]!;
        if (row.status !== 'pending' && row.status !== 'escalated') {
          throw new Error('unreachable in first attempt');
        }
        await dispatchApproved(tx, row, userMod);
        await tx
          .update(approvals)
          .set({ status: 'approved', decidedBy: userMod, decidedAt: new Date() })
          .where(eq(approvals.id, row.id));
      },
    );

    // Second moderator tries to decide — must see the committed state.
    const secondResult = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => {
        const rows = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.id, approvalId))
          .for('update');
        const row = rows[0]!;
        return {
          status: row.status,
          decidedBy: row.decidedBy,
          isPending: row.status === 'pending' || row.status === 'escalated',
        };
      },
    );
    expect(secondResult.isPending).toBe(false);
    expect(secondResult.status).toBe('approved');
    expect(secondResult.decidedBy).toBe(userMod);
  });
});

describe('approveWithEdits — dispatches the edited body', () => {
  const approvalId = '44444444-4444-4444-8444-fe0000000004';
  it('inbox_message body matches the edited payload, not the original', async () => {
    await makeApproval({
      id: approvalId,
      threadIdInPayload: threadId,
      body: 'Borrador original — promesa demasiado fuerte.',
    });

    const editedBody = 'Versión editada y suavizada antes de salir.';
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userMod },
      async (tx) => {
        const rows = await tx
          .select()
          .from(approvals)
          .where(eq(approvals.id, approvalId))
          .for('update');
        const row = rows[0]!;
        const editedPayload = {
          ...(row.proposedPayload as Record<string, unknown>),
          messageBody: editedBody,
        };
        // Dispatch using the edited payload
        await dispatchApproved(
          tx,
          {
            id: row.id,
            organizationId: row.organizationId,
            entityTable: row.entityTable,
            entityId: row.entityId,
            proposedPayload: editedPayload,
          },
          userMod,
        );
        // Swap proposed → original, write edited
        await tx
          .update(approvals)
          .set({
            status: 'edited_approved',
            originalPayload: row.proposedPayload as object,
            proposedPayload: editedPayload,
            decidedBy: userMod,
            decidedAt: new Date(),
          })
          .where(eq(approvals.id, row.id));
      },
    );

    const [msg] = await runAdmin<Array<typeof inboxMessages.$inferSelect>>(
      fixture.db,
      async (tx) =>
        tx
          .select()
          .from(inboxMessages)
          .where(eq(inboxMessages.id, approvalId.replace('44444444', '55555555'))),
    );
    expect(msg?.body).toBe(editedBody);

    const [appr] = await runAdmin<Array<typeof approvals.$inferSelect>>(
      fixture.db,
      async (tx) => tx.select().from(approvals).where(eq(approvals.id, approvalId)),
    );
    expect(appr?.status).toBe('edited_approved');
    expect((appr?.originalPayload as Record<string, unknown>)?.messageBody).toBe(
      'Borrador original — promesa demasiado fuerte.',
    );
    expect((appr?.proposedPayload as Record<string, unknown>)?.messageBody).toBe(editedBody);
  });
});

describe('dispatch contract for non-inbox entity tables', () => {
  it('post entity_table with an invalid proposed_payload throws VALIDATION_ERROR', async () => {
    // Commit 20b wires the post dispatcher. The "lands in Phase 6"
    // NOT_IMPLEMENTED message is gone; an empty proposed_payload is
    // now rejected as a malformed approval (same pattern as
    // review_responses).
    const fakeApproval = {
      id: '44444444-4444-4444-8444-fe0000000099',
      organizationId: orgA,
      entityTable: 'posts',
      entityId: '55555555-5555-4555-8555-fe0000000099',
      proposedPayload: {},
    };
    await expect(
      runAs(
        fixture.db,
        { orgId: orgA, userId: userMod },
        async (tx) => dispatchApproved(tx, fakeApproval, userMod),
      ),
    ).rejects.toThrow(/no es un payload de post válido/);
  });

  it('review_responses with an invalid proposed_payload throws VALIDATION_ERROR', async () => {
    // Commit 14 wires the review-response dispatcher. The "land in
    // Phase 5" NOT_IMPLEMENTED message is gone; instead the
    // dispatcher validates the payload shape and rejects an empty
    // proposed_payload as a malformed approval.
    const fakeApproval = {
      id: '44444444-4444-4444-8444-fe0000000098',
      organizationId: orgA,
      entityTable: 'review_responses',
      entityId: '55555555-5555-4555-8555-fe0000000098',
      proposedPayload: {},
    };
    await expect(
      runAs(
        fixture.db,
        { orgId: orgA, userId: userMod },
        async (tx) => dispatchApproved(tx, fakeApproval, userMod),
      ),
    ).rejects.toThrow(/not a valid review_response shape/);
  });
});

// Keep `and` reference live in this file (used by some imports we may
// add later); silences "unused import" without changing behavior.
void and;
void auditEvents;
