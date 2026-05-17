import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { dispatchApproved, dispatchRejection } from '../../lib/approvals/dispatch';
import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  approvals,
  auditEvents,
  brands,
  connectedAccounts,
  organizations,
  plans,
  postTargets,
  posts,
  users,
} from '../../lib/db/schema';
import {
  clearMockIdempotency,
  resetForcedFailures,
} from '../../lib/connectors/base';
import {
  dispatchOneTarget,
  type DispatchOneTargetDeps,
} from '../../lib/jobs/publish-target';
import {
  runPublishTick,
  type PublishTickDeps,
} from '../../lib/jobs/publish-post';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * `dispatchPostApproval` + `dispatchPostRejection` integration (Commit 20b).
 *
 * Same sequential-lock strategy as reviews-approval-dispatch.test.ts:
 * pglite single-connection means we can't race two transactions in
 * real time, so we simulate the production lock contract:
 *
 *   1. Tx A: SELECT FOR UPDATE approval → dispatch → UPDATE.
 *   2. Tx B (same approval): SELECT FOR UPDATE sees `status='approved'`
 *      and aborts with APPROVAL_ALREADY_DECIDED.
 *
 * Branch matrix exercised:
 *
 *   - approve + `scheduled_at != null` → `posts.status='scheduled'`,
 *     `needsSyncDispatch=false`.
 *   - approve + `scheduled_at == null` → `posts.status='publishing'`,
 *     `needsSyncDispatch=true`. We then invoke `runPublishTick` to
 *     prove the C20b-extended Set B selector picks up the post and
 *     drives it to a terminal `'published'`.
 *   - reject → `posts.status='cancelled'`.
 *   - approveWithEdits (with `editedText` in editedPayload) → text
 *     updated AND status transitions identically to plain approve.
 *   - sequential second approve → APPROVAL_ALREADY_DECIDED.
 */

let fixture: TestDb;
let tickDeps: PublishTickDeps;

const planId = '00000000-0000-4000-8000-fa00fa00fa00';
const orgId = '11111111-1111-4111-8111-fa00fa00fa00';
const userId = '22222222-2222-4222-8222-fa00fa00fa00';
const brandId = '33333333-3333-4333-8333-fa00fa00fa00';
const accountId = '44444444-4444-4444-8444-fa00fa00fa00';

beforeAll(async () => {
  fixture = await createTestDb();
  const baseDeps: DispatchOneTargetDeps = {
    asUser: <T,>(
      ctx: { orgId: string; userId: string },
      fn: (tx: AnyPgTx) => Promise<T>,
    ) => runAs(fixture.db, ctx, fn),
    asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    now: () => new Date(),
  };
  tickDeps = {
    ...baseDeps,
    dispatchTarget: dispatchOneTarget,
  };

  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userId, email: 'mod@pad.test', name: 'Mod' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'PAD Org',
      slug: 'pad-org',
      planId,
    });
    await tx.insert(brands).values({
      id: brandId,
      organizationId: orgId,
      name: 'PAD Brand',
      slug: 'pad-brand',
    });
    await tx.insert(connectedAccounts).values({
      id: accountId,
      organizationId: orgId,
      brandId,
      platform: 'mock',
      externalAccountId: 'mock-pad',
      displayName: 'Mock acct',
    });
  });

  process.env.BLACKNEL_MOCK_FAST_PUBLISH = 'true';
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
  delete process.env.BLACKNEL_MOCK_FAST_PUBLISH;
});

afterEach(() => {
  resetForcedFailures();
  clearMockIdempotency();
});

// ---------------------------------------------------------------------------
// Seed helper — pending_approval post + matching approval row.
// ---------------------------------------------------------------------------

interface SeedPendingOpts {
  postId: string;
  targetId: string;
  approvalId: string;
  text: string;
  scheduledAtIso: string | null;
  idempotencyKey: string;
}

async function seedPendingApprovalPost(opts: SeedPendingOpts): Promise<void> {
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(posts).values({
      id: opts.postId,
      organizationId: orgId,
      brandId,
      authorId: userId,
      status: 'pending_approval',
      text: opts.text,
      ...(opts.scheduledAtIso ? { scheduledAt: new Date(opts.scheduledAtIso) } : {}),
    });
    await tx.insert(postTargets).values({
      id: opts.targetId,
      organizationId: orgId,
      postId: opts.postId,
      connectedAccountId: accountId,
      idempotencyKey: opts.idempotencyKey,
    });
    await tx.insert(approvals).values({
      id: opts.approvalId,
      organizationId: orgId,
      kind: 'post',
      entityTable: 'posts',
      entityId: opts.postId,
      requestedBy: userId,
      status: 'pending',
      riskLevel: 'medium',
      proposedPayload: {
        kind: 'post',
        postId: opts.postId,
        scheduledAtIso: opts.scheduledAtIso,
        targetPlatforms: ['mock'],
        approvalReason: 'brand_rule',
      },
    });
  });
}

async function getPostStatus(postId: string): Promise<string> {
  const rows = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
    tx.select({ status: posts.status }).from(posts).where(eq(posts.id, postId)),
  );
  return rows[0]?.status ?? 'missing';
}

async function getPostText(postId: string): Promise<string> {
  const rows = await runAdmin<Array<{ text: string }>>(fixture.db, (tx) =>
    tx.select({ text: posts.text }).from(posts).where(eq(posts.id, postId)),
  );
  return rows[0]?.text ?? '';
}

// ---------------------------------------------------------------------------
// 1. Approve with scheduled_at → 'scheduled'
// ---------------------------------------------------------------------------

describe('dispatchPostApproval — approve + scheduled_at', () => {
  const postId = '99999999-9999-4999-8999-fa00fa00fa01';
  const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-fa00fa00fa01';
  const approvalId = 'bbbbbbbb-bbbb-4bbb-8bbb-fa00fa00fa01';
  const scheduledAtIso = new Date(Date.now() + 60 * 60_000).toISOString();

  it('flips posts.status → scheduled and does NOT need sync dispatch', async () => {
    await seedPendingApprovalPost({
      postId,
      targetId,
      approvalId,
      text: 'Programado al aprobar.',
      scheduledAtIso,
      idempotencyKey: 'idem-pad-sched-1',
    });

    const outcome = await runAs<{
      postId?: string;
      postToStatus?: string;
      postNeedsSyncDispatch?: boolean;
    }>(fixture.db, { orgId, userId }, async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          kind: approvals.kind,
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
      const result = await dispatchApproved(tx, row, userId);
      await tx
        .update(approvals)
        .set({ status: 'approved', decidedBy: userId, decidedAt: new Date() })
        .where(eq(approvals.id, approvalId));
      return {
        postId: result.postId,
        postToStatus: result.postToStatus,
        postNeedsSyncDispatch: result.postNeedsSyncDispatch,
      };
    });

    expect(outcome.postId).toBe(postId);
    expect(outcome.postToStatus).toBe('scheduled');
    expect(outcome.postNeedsSyncDispatch).toBe(false);
    expect(await getPostStatus(postId)).toBe('scheduled');

    const targets = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: postTargets.status }).from(postTargets).where(eq(postTargets.id, targetId)),
    );
    expect(targets[0]?.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// 2. Approve without scheduled_at → 'publishing' + sync dispatch via runPublishTick
// ---------------------------------------------------------------------------

describe('dispatchPostApproval — approve sin scheduled_at + sync dispatch', () => {
  const postId = '99999999-9999-4999-8999-fa00fa00fa02';
  const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-fa00fa00fa02';
  const approvalId = 'bbbbbbbb-bbbb-4bbb-8bbb-fa00fa00fa02';

  it('flips post to publishing and runPublishTick drives it to published', async () => {
    await seedPendingApprovalPost({
      postId,
      targetId,
      approvalId,
      text: 'Publicar ahora al aprobar.',
      scheduledAtIso: null,
      idempotencyKey: 'idem-pad-now-1',
    });

    const outcome = await runAs<{ postNeedsSyncDispatch: boolean; postToStatus: string }>(
      fixture.db,
      { orgId, userId },
      async (tx) => {
        const lockedRows = await tx
          .select({
            id: approvals.id,
            organizationId: approvals.organizationId,
            kind: approvals.kind,
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
        const result = await dispatchApproved(tx, row, userId);
        await tx
          .update(approvals)
          .set({ status: 'approved', decidedBy: userId, decidedAt: new Date() })
          .where(eq(approvals.id, approvalId));
        return {
          postNeedsSyncDispatch: result.postNeedsSyncDispatch === true,
          postToStatus: result.postToStatus ?? 'missing',
        };
      },
    );

    expect(outcome.postToStatus).toBe('publishing');
    expect(outcome.postNeedsSyncDispatch).toBe(true);
    expect(await getPostStatus(postId)).toBe('publishing');

    // Sync dispatch via the cron — Set B now also catches pending
    // targets under publishing posts (Commit 20b extension).
    const tickResult = await runPublishTick(tickDeps);
    expect(tickResult.ok).toBe(true);
    if (!tickResult.ok) return;
    expect(tickResult.data.candidatesFound).toBeGreaterThanOrEqual(1);

    // Post + target reach terminal 'published'.
    expect(await getPostStatus(postId)).toBe('published');
    const targets = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: postTargets.status }).from(postTargets).where(eq(postTargets.id, targetId)),
    );
    expect(targets[0]?.status).toBe('published');
  });
});

// ---------------------------------------------------------------------------
// 3. Reject → 'cancelled'
// ---------------------------------------------------------------------------

describe('dispatchPostRejection', () => {
  const postId = '99999999-9999-4999-8999-fa00fa00fa03';
  const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-fa00fa00fa03';
  const approvalId = 'bbbbbbbb-bbbb-4bbb-8bbb-fa00fa00fa03';

  it('flips post → cancelled while targets stay pending', async () => {
    await seedPendingApprovalPost({
      postId,
      targetId,
      approvalId,
      text: 'Rechazado por compliance.',
      scheduledAtIso: null,
      idempotencyKey: 'idem-pad-rej-1',
    });

    await runAs(fixture.db, { orgId, userId }, async (tx) => {
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
          decidedBy: userId,
          decidedAt: new Date(),
          decisionReason: 'voz de marca',
        })
        .where(eq(approvals.id, approvalId));
    });

    expect(await getPostStatus(postId)).toBe('cancelled');
    const targets = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: postTargets.status }).from(postTargets).where(eq(postTargets.id, targetId)),
    );
    // Targets never advanced — `cancelled` is terminal at the post level.
    expect(targets[0]?.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// 4. approveWithEdits — editedText applied to posts.text + scheduled status
// ---------------------------------------------------------------------------

describe('dispatchPostApproval — approveWithEdits applies editedText', () => {
  const postId = '99999999-9999-4999-8999-fa00fa00fa04';
  const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-fa00fa00fa04';
  const approvalId = 'bbbbbbbb-bbbb-4bbb-8bbb-fa00fa00fa04';
  const scheduledAtIso = new Date(Date.now() + 30 * 60_000).toISOString();

  it('updates posts.text to editedText and transitions to scheduled', async () => {
    await seedPendingApprovalPost({
      postId,
      targetId,
      approvalId,
      text: 'Borrador original con palabra refund.',
      scheduledAtIso,
      idempotencyKey: 'idem-pad-edit-1',
    });

    const editedText = 'Versión revisada sin promesas monetarias.';

    await runAs(fixture.db, { orgId, userId }, async (tx) => {
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
        editedText,
      };
      const result = await dispatchApproved(
        tx,
        {
          id: row.id,
          organizationId: row.organizationId,
          entityTable: row.entityTable,
          entityId: row.entityId,
          proposedPayload: editedPayload,
        },
        userId,
      );
      expect(result.postTextEdited).toBe(true);

      await tx
        .update(approvals)
        .set({
          status: 'edited_approved',
          originalPayload: row.proposedPayload as object,
          proposedPayload: editedPayload,
          decidedBy: userId,
          decidedAt: new Date(),
        })
        .where(eq(approvals.id, approvalId));
    });

    expect(await getPostStatus(postId)).toBe('scheduled');
    expect(await getPostText(postId)).toBe(editedText);
  });
});

// ---------------------------------------------------------------------------
// 5. Sequential concurrency — second approve sees APPROVAL_ALREADY_DECIDED
// ---------------------------------------------------------------------------

describe('Concurrency — second approve sees APPROVAL_ALREADY_DECIDED', () => {
  const postId = '99999999-9999-4999-8999-fa00fa00fa05';
  const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-fa00fa00fa05';
  const approvalId = 'bbbbbbbb-bbbb-4bbb-8bbb-fa00fa00fa05';
  const scheduledAtIso = new Date(Date.now() + 90 * 60_000).toISOString();

  it('first approve commits, second attempt aborts before re-dispatching', async () => {
    await seedPendingApprovalPost({
      postId,
      targetId,
      approvalId,
      text: 'Doble aprobación: solo la primera gana.',
      scheduledAtIso,
      idempotencyKey: 'idem-pad-conc-1',
    });

    // ---- First moderator approves ----
    await runAs(fixture.db, { orgId, userId }, async (tx) => {
      const lockedRows = await tx
        .select({
          id: approvals.id,
          organizationId: approvals.organizationId,
          kind: approvals.kind,
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
      await dispatchApproved(tx, row, userId);
      await tx
        .update(approvals)
        .set({ status: 'approved', decidedBy: userId, decidedAt: new Date() })
        .where(eq(approvals.id, approvalId));
    });

    // ---- Second moderator attempts the same approval ----
    const second = await runAs<
      { kind: 'ok' } | { kind: 'already_decided'; status: string }
    >(fixture.db, { orgId, userId }, async (tx) => {
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

    expect(second.kind).toBe('already_decided');
    if (second.kind === 'already_decided') {
      expect(second.status).toBe('approved');
    }

    // The first dispatch landed on 'scheduled' — second tx never
    // re-dispatched, so the row stays consistent (no double transition).
    expect(await getPostStatus(postId)).toBe('scheduled');
  });
});

// ---------------------------------------------------------------------------
// 6. Already-decided guard — dispatch refuses if the post drifted out of
//    pending_approval between approval creation and decision (defense in depth).
// ---------------------------------------------------------------------------

describe('dispatchPostApproval — already-not-pending guard', () => {
  const postId = '99999999-9999-4999-8999-fa00fa00fa06';
  const targetId = 'aaaaaaaa-aaaa-4aaa-8aaa-fa00fa00fa06';
  const approvalId = 'bbbbbbbb-bbbb-4bbb-8bbb-fa00fa00fa06';

  it('throws CONFLICT when posts.status drifted out of pending_approval', async () => {
    await seedPendingApprovalPost({
      postId,
      targetId,
      approvalId,
      text: 'Drift de estado fuera de pending_approval.',
      scheduledAtIso: null,
      idempotencyKey: 'idem-pad-drift-1',
    });

    // Simulate an out-of-band cancel that happened between the
    // approval being created and the moderator deciding.
    await runAdmin(fixture.db, (tx) =>
      tx.update(posts).set({ status: 'cancelled' }).where(eq(posts.id, postId)),
    );

    await expect(
      runAs(fixture.db, { orgId, userId }, async (tx) => {
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
        await dispatchApproved(
          tx,
          { ...lockedRows[0]!, kind: 'post', status: 'pending' } as never,
          userId,
        );
      }),
    ).rejects.toThrow(/pendiente de aprobación/);
  });
});

// Keep `auditEvents` + `sql` imports live for future audit-name
// assertions; the dispatcher writes are caller-driven (Server
// Action) so we don't audit-assert in this dispatch-level suite.
void auditEvents;
void sql;
