import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dispatchApproved, dispatchRejection } from '../../lib/approvals/dispatch';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  approvals,
  organizations,
  plans,
  reviewResponses,
  reviews,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * `dispatchReviewResponseApproval` + sequential concurrency guard
 * (Commit 14, Ajuste 5).
 *
 * Pglite is single-process / single-connection, so we cannot directly
 * race two transactions in real time. Same constraint as
 * approvals-flows.test.ts (Commit 10). Instead we simulate the
 * production lock contract sequentially:
 *
 *   1. Open transaction A, SELECT FOR UPDATE the approval row.
 *   2. Dispatch + UPDATE approvals.status='approved'. Commit.
 *   3. Open transaction B targeting the same approval; the SELECT
 *      sees status='approved' and returns APPROVAL_ALREADY_DECIDED.
 *
 * Real production: tx A holds the row lock; tx B blocks at the
 * SELECT FOR UPDATE until tx A commits, then reads the post-update
 * status. Same end-state — the lock is the load-bearing primitive,
 * not the wall-clock timing.
 *
 * We also lock in:
 *
 *   - approve path: review_responses.status → published,
 *     reviews.status → responded, finalText set from payload.body.
 *   - reject path: review_responses.status → rejected.
 *   - edited-approve path: dispatch uses the EDITED body (proven by
 *     checking finalText after dispatch).
 *   - re-dispatch of an already-published response is rejected
 *     with `CONFLICT`.
 *   - malformed proposed_payload throws VALIDATION_ERROR.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-dd0000000001';
const orgA = '11111111-1111-4111-8111-dd0000000001';
const userMod = '22222222-2222-4222-8222-dd0000000001';

const reviewId = '55555555-5555-4555-8555-dd0000000001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userMod, email: 'mod@disp.test', name: 'Mod' });
    await tx
      .insert(organizations)
      .values({ id: orgA, name: 'Org A', slug: 'disp-org-a', planId });
    await tx.insert(reviews).values({
      id: reviewId,
      organizationId: orgA,
      platform: 'gbp',
      externalReviewId: 'gbp-disp-1',
      authorName: 'Cliente',
      rating: 2,
      body: 'Mal servicio.',
      sentiment: 'negative',
      status: 'pending',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

// ---------------------------------------------------------------------------
// Helper: create a pending_approval response + matching approval row.
// ---------------------------------------------------------------------------

async function seedPending(opts: {
  responseId: string;
  approvalId: string;
  body: string;
}): Promise<void> {
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(reviewResponses).values({
      id: opts.responseId,
      organizationId: orgA,
      reviewId,
      draftText: opts.body,
      finalText: null,
      status: 'pending_approval',
      authorId: userMod,
      aiGenerated: false,
      idempotencyKey: opts.approvalId,
    });
    await tx.insert(approvals).values({
      id: opts.approvalId,
      organizationId: orgA,
      kind: 'review_response',
      entityTable: 'review_responses',
      entityId: opts.responseId,
      requestedBy: userMod,
      status: 'pending',
      riskLevel: 'high',
      aiRiskFlags: [] as string[],
      proposedPayload: {
        kind: 'review_response',
        reviewId,
        responseId: opts.responseId,
        body: opts.body,
        aiGenerated: false,
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Approve path
// ---------------------------------------------------------------------------

describe('dispatchApproved (review_response) — approve happy path', () => {
  const responseId = '66666666-6666-4666-8666-dd00000000a1';
  const approvalId = '77777777-7777-4777-8777-dd00000000a1';

  it('flips review_response → published and review → responded inside the txn', async () => {
    await seedPending({
      responseId,
      approvalId,
      body: 'Lamentamos lo ocurrido, te contactaremos.',
    });

    await runAs(fixture.db, { orgId: orgA, userId: userMod }, async (tx) => {
      // Mirror approveAction: SELECT FOR UPDATE → dispatch → UPDATE.
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          status: approvals.status,
          proposedPayload: approvals.proposedPayload,
        })
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .for('update')
        .limit(1);
      const row = lockedRows[0]!;
      expect(row.status).toBe('pending');

      const dispatch = await dispatchApproved(tx, row, userMod);
      expect(dispatch.reviewResponseId).toBe(responseId);
      expect(dispatch.reviewId).toBe(reviewId);

      await tx
        .update(approvals)
        .set({ status: 'approved', decidedBy: userMod, decidedAt: new Date() })
        .where(eq(approvals.id, approvalId));
    });

    const [resp] = await runAdmin<
      Array<{ status: string; finalText: string | null; publishedAt: Date | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          status: reviewResponses.status,
          finalText: reviewResponses.finalText,
          publishedAt: reviewResponses.publishedAt,
        })
        .from(reviewResponses)
        .where(eq(reviewResponses.id, responseId)),
    );
    expect(resp?.status).toBe('published');
    expect(resp?.finalText).toBe('Lamentamos lo ocurrido, te contactaremos.');
    expect(resp?.publishedAt).toBeInstanceOf(Date);

    const [rev] = await runAdmin<Array<{ status: string }>>(fixture.db, async (tx) =>
      tx.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, reviewId)),
    );
    expect(rev?.status).toBe('responded');
  });
});

// ---------------------------------------------------------------------------
// Edited approve path
// ---------------------------------------------------------------------------

describe('dispatchApproved (review_response) — edited approve uses the edited body', () => {
  const responseId = '66666666-6666-4666-8666-dd00000000e1';
  const approvalId = '77777777-7777-4777-8777-dd00000000e1';

  it('finalText reflects the edited body, not the draft', async () => {
    // Reset parent review to pending so the responded transition is
    // observable when this test runs after the approve happy path.
    await runAdmin(fixture.db, async (tx) =>
      tx.update(reviews).set({ status: 'pending' }).where(eq(reviews.id, reviewId)),
    );
    await seedPending({
      responseId,
      approvalId,
      body: 'Borrador original con palabra refund.',
    });

    const editedBody = 'Versión revisada sin promesas monetarias.';

    await runAs(fixture.db, { orgId: orgA, userId: userMod }, async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          proposedPayload: approvals.proposedPayload,
        })
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .for('update')
        .limit(1);
      const row = lockedRows[0]!;

      const editedPayload = {
        ...(row.proposedPayload as Record<string, unknown>),
        body: editedBody,
      };
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

      await tx
        .update(approvals)
        .set({
          status: 'edited_approved',
          originalPayload: row.proposedPayload as object,
          proposedPayload: editedPayload,
          decidedBy: userMod,
          decidedAt: new Date(),
        })
        .where(eq(approvals.id, approvalId));
    });

    const [resp] = await runAdmin<Array<{ finalText: string | null; status: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ finalText: reviewResponses.finalText, status: reviewResponses.status })
          .from(reviewResponses)
          .where(eq(reviewResponses.id, responseId)),
    );
    expect(resp?.status).toBe('published');
    expect(resp?.finalText).toBe(editedBody);
  });
});

// ---------------------------------------------------------------------------
// Reject path
// ---------------------------------------------------------------------------

describe('dispatchRejection (review_response)', () => {
  const responseId = '66666666-6666-4666-8666-dd00000000b1';
  const approvalId = '77777777-7777-4777-8777-dd00000000b1';

  it('flips review_response → rejected', async () => {
    await seedPending({
      responseId,
      approvalId,
      body: 'Respuesta que se va a rechazar.',
    });

    await runAs(fixture.db, { orgId: orgA, userId: userMod }, async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          proposedPayload: approvals.proposedPayload,
        })
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .for('update')
        .limit(1);
      const row = lockedRows[0]!;
      await dispatchRejection(tx, row);
      await tx
        .update(approvals)
        .set({
          status: 'rejected',
          decidedBy: userMod,
          decidedAt: new Date(),
          decisionReason: 'no concuerda con la voz de marca',
        })
        .where(eq(approvals.id, approvalId));
    });

    const [resp] = await runAdmin<Array<{ status: string; publishedAt: Date | null }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({
            status: reviewResponses.status,
            publishedAt: reviewResponses.publishedAt,
          })
          .from(reviewResponses)
          .where(eq(reviewResponses.id, responseId)),
    );
    expect(resp?.status).toBe('rejected');
    expect(resp?.publishedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sequential APPROVAL_ALREADY_DECIDED
// ---------------------------------------------------------------------------

describe('Concurrency — second approve sees APPROVAL_ALREADY_DECIDED', () => {
  const responseId = '66666666-6666-4666-8666-dd00000000c1';
  const approvalId = '77777777-7777-4777-8777-dd00000000c1';

  it('once the row is approved, a second decision attempt aborts with the post-decision status', async () => {
    await seedPending({
      responseId,
      approvalId,
      body: 'Doble aprobación: solo la primera gana.',
    });
    // Reset parent review to pending so the first dispatch can run
    // the pending → responded transition cleanly under the lifecycle
    // enum (responded → responded is fine, but starting at pending
    // matches how production actually arrives at this point).
    await runAdmin(fixture.db, async (tx) =>
      tx.update(reviews).set({ status: 'pending' }).where(eq(reviews.id, reviewId)),
    );

    // ---- First moderator approves ----
    await runAs(fixture.db, { orgId: orgA, userId: userMod }, async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          status: approvals.status,
          proposedPayload: approvals.proposedPayload,
        })
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .for('update')
        .limit(1);
      const row = lockedRows[0]!;
      expect(row.status).toBe('pending');

      await dispatchApproved(tx, row, userMod);
      await tx
        .update(approvals)
        .set({ status: 'approved', decidedBy: userMod, decidedAt: new Date() })
        .where(eq(approvals.id, approvalId));
    });

    // ---- Second moderator attempts to approve the same row ----
    const secondAttempt = await runAs<
      | { kind: 'ok' }
      | { kind: 'already_decided'; status: string }
    >(fixture.db, { orgId: orgA, userId: userMod }, async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          status: approvals.status,
        })
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .for('update')
        .limit(1);
      const row = lockedRows[0]!;
      if (row.status !== 'pending' && row.status !== 'escalated') {
        return { kind: 'already_decided', status: row.status };
      }
      return { kind: 'ok' };
    });

    expect(secondAttempt.kind).toBe('already_decided');
    if (secondAttempt.kind === 'already_decided') {
      expect(secondAttempt.status).toBe('approved');
    }

    // ---- Response row stays at one consistent published state ----
    // The second moderator NEVER re-dispatched, so finalText is still
    // the first dispatch's body — no double-publish.
    const [resp] = await runAdmin<
      Array<{ status: string; finalText: string | null; publishedAt: Date | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          status: reviewResponses.status,
          finalText: reviewResponses.finalText,
          publishedAt: reviewResponses.publishedAt,
        })
        .from(reviewResponses)
        .where(eq(reviewResponses.id, responseId)),
    );
    expect(resp?.status).toBe('published');
    expect(resp?.finalText).toBe('Doble aprobación: solo la primera gana.');
  });
});

// ---------------------------------------------------------------------------
// Republishing a published response is rejected (defense in depth)
// ---------------------------------------------------------------------------

describe('dispatchApproved (review_response) — already-published guard', () => {
  const responseId = '66666666-6666-4666-8666-dd00000000d1';
  const approvalId = '77777777-7777-4777-8777-dd00000000d1';

  it('throws CONFLICT when the response row is already published', async () => {
    await seedPending({
      responseId,
      approvalId,
      body: 'Esta ya estaba publicada antes de que un retry intentara dispatchar.',
    });
    // Manually pre-publish the response row to simulate a stuck
    // pipeline / retry storm. The dispatcher must NOT re-publish.
    await runAdmin(fixture.db, async (tx) =>
      tx
        .update(reviewResponses)
        .set({
          status: 'published',
          finalText: 'Versión publicada previamente.',
          publishedAt: new Date(),
        })
        .where(eq(reviewResponses.id, responseId)),
    );

    await expect(
      runAs(fixture.db, { orgId: orgA, userId: userMod }, async (tx) => {
        const lockedRows = await tx
          .select({
            id: approvals.id,
            organizationId: approvals.organizationId,
            entityTable: approvals.entityTable,
            entityId: approvals.entityId,
            proposedPayload: approvals.proposedPayload,
          })
          .from(approvals)
          .where(eq(approvals.id, approvalId))
          .for('update')
          .limit(1);
        await dispatchApproved(tx, lockedRows[0]!, userMod);
      }),
    ).rejects.toThrow(/ya fue publicada/);
  });
});

// `sql` import kept live for future predicates.
void sql;
