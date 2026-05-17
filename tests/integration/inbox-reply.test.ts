import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import { _clearLruForTests } from '../../lib/ai/cache';
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
import { sendReplyToThread, type ReplyDeps } from '../../lib/inbox/send-reply';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * End-to-end coverage of `sendReplyToThread` — the orchestrator that
 * sits behind the inbox composer. We exercise the three terminal flows
 * the Phase-4 stub can produce:
 *
 *   1. Safe send: writes an inbox_messages row, bumps last_message_at,
 *      audits `inbox.reply.sent`.
 *   2. Unresolved placeholder: nothing persists EXCEPT a
 *      `inbox.reply.blocked_unresolved` audit row.
 *   3. Sensitive keyword (refund / lawyer / etc.): no message yet;
 *      writes an approvals row + two audit rows
 *      (`inbox.reply.routed_to_approval` + `approval.created`).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fb0000000001';
const orgA = '11111111-1111-4111-8111-fb0000000001';
const orgB = '11111111-1111-4111-8111-fb0000000002';
const userA = '22222222-2222-4222-8222-fb0000000001';

const threadA1 = '33333333-3333-4333-8333-fb0000000001';
const threadA2 = '33333333-3333-4333-8333-fb0000000002';
const threadA3 = '33333333-3333-4333-8333-fb0000000003';

beforeAll(async () => {
  fixture = await createTestDb();
  // Commit 23 — sendReplyToThread now calls checkCompliance which
  // goes through aiClient → persistence. Wire the persistence
  // seam to the fixture pglite.
  _setDbDepsForTests({
    asAdmin: (fn) => runAdmin(fixture.db, fn),
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
  });
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@reply.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'reply-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'reply-org-b', planId },
    ]);
    await tx.insert(contactProfiles).values({
      id: 'cccccccc-cccc-4ccc-8ccc-fb0000000001',
      organizationId: orgA,
      platform: 'facebook',
      externalId: 'ext-contact-A',
      displayName: 'Cliente Demo',
    });
    await tx.insert(inboxThreads).values([
      {
        id: threadA1,
        organizationId: orgA,
        platform: 'facebook',
        contactProfileId: 'cccccccc-cccc-4ccc-8ccc-fb0000000001',
        kind: 'dm',
        status: 'open',
        priority: 'normal',
        sentiment: 'neutral',
      },
      {
        id: threadA2,
        organizationId: orgA,
        platform: 'facebook',
        contactProfileId: 'cccccccc-cccc-4ccc-8ccc-fb0000000001',
        kind: 'dm',
        status: 'open',
        priority: 'normal',
        sentiment: 'neutral',
      },
      {
        id: threadA3,
        organizationId: orgA,
        platform: 'facebook',
        contactProfileId: 'cccccccc-cccc-4ccc-8ccc-fb0000000001',
        kind: 'dm',
        status: 'open',
        priority: 'normal',
        sentiment: 'neutral',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  _clearLruForTests();
  await fixture.dispose();
});

function makeDeps(): ReplyDeps {
  return {
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
    asAdmin: (fn) => runAdmin(fixture.db, fn),
  };
}

describe('sendReplyToThread — safe direct send', () => {
  it('inserts message + bumps last_message_at + audits inbox.reply.sent', async () => {
    const before = await runAdmin(fixture.db, async (tx) =>
      tx
        .select({ at: inboxThreads.lastMessageAt })
        .from(inboxThreads)
        .where(eq(inboxThreads.id, threadA1)),
    );

    const result = await sendReplyToThread(
      { orgId: orgA, userId: userA },
      {
        threadId: threadA1,
        messageBody: 'Gracias por tu mensaje, te confirmo la reserva.',
      },
      makeDeps(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('sent');
    expect(result.data.messageId).toBeDefined();

    // Message persisted
    const msgs = await runAdmin(fixture.db, async (tx) =>
      tx.select().from(inboxMessages).where(eq(inboxMessages.threadId, threadA1)),
    );
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.direction).toBe('outbound');
    expect(msgs[0]?.authorType).toBe('user');

    // last_message_at advanced
    const after = await runAdmin(fixture.db, async (tx) =>
      tx
        .select({ at: inboxThreads.lastMessageAt })
        .from(inboxThreads)
        .where(eq(inboxThreads.id, threadA1)),
    );
    expect((after[0]!.at as Date).getTime()).toBeGreaterThanOrEqual(
      (before[0]!.at as Date).getTime(),
    );

    // Audit row
    const audit = await runAdmin(fixture.db, async (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.entityId, result.data.messageId!)),
    );
    expect(audit.length).toBe(1);
    expect(audit[0]?.action).toBe('inbox.reply.sent');
    expect(audit[0]?.entityType).toBe('inbox_message');
    expect(audit[0]?.userId).toBe(userA);
  });
});

describe('sendReplyToThread — unresolved placeholder', () => {
  it('does NOT insert a message, audits inbox.reply.blocked_unresolved', async () => {
    const beforeMessages = await runAdmin(fixture.db, async (tx) =>
      tx.select().from(inboxMessages).where(eq(inboxMessages.threadId, threadA2)),
    );

    const result = await sendReplyToThread(
      { orgId: orgA, userId: userA },
      {
        threadId: threadA2,
        messageBody: 'Hola, tu pedido va camino. Más info: {link}',
      },
      makeDeps(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('UNRESOLVED_PLACEHOLDERS');
    expect(result.error.meta?.unresolved).toEqual(['link']);

    // No new message
    const afterMessages = await runAdmin(fixture.db, async (tx) =>
      tx.select().from(inboxMessages).where(eq(inboxMessages.threadId, threadA2)),
    );
    expect(afterMessages.length).toBe(beforeMessages.length);

    // Audit row written
    const audit = await runAdmin<typeof auditEvents.$inferSelect[]>(
      fixture.db,
      async (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, threadA2)),
    );
    const blocked = audit.filter(
      (a: typeof auditEvents.$inferSelect) =>
        a.action === 'inbox.reply.blocked_unresolved',
    );
    expect(blocked.length).toBeGreaterThanOrEqual(1);
    expect(blocked[0]?.after).toMatchObject({ unresolved: ['link'] });
  });
});

describe('sendReplyToThread — sensitive keyword routes to approval', () => {
  it('creates an approval row + two audit events; no message inserted', async () => {
    const result = await sendReplyToThread(
      { orgId: orgA, userId: userA },
      {
        threadId: threadA3,
        messageBody: 'Te garantizamos un reembolso completo en 24h.',
      },
      makeDeps(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.outcome).toBe('routed_to_approval');
    const approvalId = result.data.approvalId!;
    expect(approvalId).toBeDefined();

    // No message for this thread.
    const msgs = await runAdmin(fixture.db, async (tx) =>
      tx.select().from(inboxMessages).where(eq(inboxMessages.threadId, threadA3)),
    );
    expect(msgs.length).toBe(0);

    // Approval row carries the proposed payload + risk flags.
    const [appr] = await runAdmin(fixture.db, async (tx) =>
      tx.select().from(approvals).where(eq(approvals.id, approvalId)),
    );
    expect(appr).toBeDefined();
    expect(appr?.kind).toBe('inbox_reply');
    expect(appr?.status).toBe('pending');
    expect(appr?.organizationId).toBe(orgA);
    expect(appr?.aiRiskFlags).toContain('refund_promise');
    expect(appr?.proposedPayload).toMatchObject({
      kind: 'inbox_reply',
      threadId: threadA3,
    });

    // Two audit rows for this approval: routed + created.
    const audits = await runAdmin<typeof auditEvents.$inferSelect[]>(
      fixture.db,
      async (tx) =>
        tx
          .select()
          .from(auditEvents)
          .where(eq(auditEvents.entityId, approvalId)),
    );
    const actions = audits
      .map((a: typeof auditEvents.$inferSelect) => a.action)
      .sort();
    expect(actions).toEqual(['approval.created', 'inbox.reply.routed_to_approval']);
  });
});

describe('sendReplyToThread — tenant safety', () => {
  it('rejects a thread that does not belong to the caller org', async () => {
    const result = await sendReplyToThread(
      { orgId: orgB, userId: userA }, // user in different org
      {
        threadId: threadA1,
        messageBody: 'Hola.',
      },
      makeDeps(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('NOT_FOUND');
  });
});
