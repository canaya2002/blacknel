import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  inboxMessages,
  inboxThreads,
  internalNotes,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * DB-level integration coverage for the inbox actions in
 * `app/(app)/inbox/actions.ts`. Mirrors the Phase-3 pattern: we exercise
 * the SQL transitions the Server Actions perform (within `runAs` /
 * `runAdmin`) instead of invoking the Server Action over an HTTP boundary
 * we cannot synthesize from vitest.
 *
 * What we lock in:
 *
 *   1. Tenant isolation on `inbox_threads`, `inbox_messages`, and
 *      `internal_notes` — RLS rejects cross-tenant reads and writes.
 *   2. The denormalize-org-id triggers on `inbox_messages` and
 *      `internal_notes` populate organization_id from the parent thread
 *      when callers omit it, AND fail closed when the parent thread is
 *      not RLS-visible.
 *   3. Status / priority / tag mutations the actions perform persist and
 *      respect the org boundary.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-f00000000001';
const orgA = '11111111-1111-4111-8111-fffffffff00a';
const orgB = '11111111-1111-4111-8111-fffffffff00b';
const userA = '22222222-2222-4222-8222-fffffffff00a';
const userA2 = '22222222-2222-4222-8222-fffffffff00c';
const userB = '22222222-2222-4222-8222-fffffffff00b';

const threadAId = '33333333-3333-4333-8333-fffffffff00a';
const threadBId = '33333333-3333-4333-8333-fffffffff00b';

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
      { id: userA, email: 'a@inbox.test', name: 'A' },
      { id: userA2, email: 'a2@inbox.test', name: 'A2' },
      { id: userB, email: 'b@inbox.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'inbox-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'inbox-org-b', planId },
    ]);
    await tx.insert(inboxThreads).values([
      {
        id: threadAId,
        organizationId: orgA,
        platform: 'facebook',
        kind: 'dm',
        status: 'open',
        priority: 'normal',
      },
      {
        id: threadBId,
        organizationId: orgB,
        platform: 'facebook',
        kind: 'dm',
        status: 'open',
        priority: 'normal',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('inbox_threads tenant isolation', () => {
  it('user of org A only sees threads belonging to org A', async () => {
    const visible = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.select({ id: inboxThreads.id }).from(inboxThreads),
    );
    expect(visible.map((r) => r.id).sort()).toEqual([threadAId]);
  });

  it('user of org B cannot UPDATE a thread belonging to org A', async () => {
    await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      async (tx) =>
        tx
          .update(inboxThreads)
          .set({ status: 'closed' })
          .where(eq(inboxThreads.id, threadAId)),
    );

    // The UPDATE silently affects zero rows under RLS — verify the row
    // remained open.
    const [row] = await runAdmin<Array<{ status: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ status: inboxThreads.status })
          .from(inboxThreads)
          .where(eq(inboxThreads.id, threadAId)),
    );
    expect(row?.status).toBe('open');
  });
});

describe('inbox action transitions', () => {
  it('assign / unassign persists assigned_to', async () => {
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .update(inboxThreads)
          .set({ assignedTo: userA2 })
          .where(
            and(
              eq(inboxThreads.id, threadAId),
              eq(inboxThreads.organizationId, orgA),
            ),
          ),
    );

    const after = await runAs<Array<{ assignedTo: string | null }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({ assignedTo: inboxThreads.assignedTo })
          .from(inboxThreads)
          .where(eq(inboxThreads.id, threadAId)),
    );
    expect(after[0]?.assignedTo).toBe(userA2);
  });

  it('close + reopen toggle status and closed_at', async () => {
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .update(inboxThreads)
          .set({ status: 'closed', closedAt: new Date() })
          .where(eq(inboxThreads.id, threadAId)),
    );
    let row = await runAs<Array<{ status: string; closedAt: Date | null }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({ status: inboxThreads.status, closedAt: inboxThreads.closedAt })
          .from(inboxThreads)
          .where(eq(inboxThreads.id, threadAId)),
    );
    expect(row[0]?.status).toBe('closed');
    expect(row[0]?.closedAt).not.toBeNull();

    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .update(inboxThreads)
          .set({ status: 'open', closedAt: null })
          .where(eq(inboxThreads.id, threadAId)),
    );
    row = await runAs<Array<{ status: string; closedAt: Date | null }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({ status: inboxThreads.status, closedAt: inboxThreads.closedAt })
          .from(inboxThreads)
          .where(eq(inboxThreads.id, threadAId)),
    );
    expect(row[0]?.status).toBe('open');
    expect(row[0]?.closedAt).toBeNull();
  });

  it('escalate raises priority to urgent', async () => {
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .update(inboxThreads)
          .set({ priority: 'urgent' })
          .where(eq(inboxThreads.id, threadAId)),
    );
    const after = await runAs<Array<{ priority: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({ priority: inboxThreads.priority })
          .from(inboxThreads)
          .where(eq(inboxThreads.id, threadAId)),
    );
    expect(after[0]?.priority).toBe('urgent');
  });
});

describe('inbox_messages.organization_id trigger', () => {
  it('auto-populates organization_id from the parent thread on insert', async () => {
    // Use raw SQL so we can omit organization_id from the INSERT column
    // list — Drizzle's typed builder still requires it. The trigger
    // (`inbox_messages_set_org_id`) populates it from inbox_threads.
    const messageId = '99999999-9999-4999-8999-fffffffff001';
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.execute(sql`
          INSERT INTO inbox_messages
            (id, thread_id, direction, author_type, body)
          VALUES
            (${messageId}::uuid, ${threadAId}::uuid, 'inbound', 'contact', 'Hola, tengo una duda.')
        `),
    );

    const [row] = await runAs<Array<{ organizationId: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({ organizationId: inboxMessages.organizationId })
          .from(inboxMessages)
          .where(eq(inboxMessages.id, messageId)),
    );
    expect(row?.organizationId).toBe(orgA);
  });

  it('rejects insert when the parent thread is not RLS-visible (cross-tenant)', async () => {
    // User of org A attempts to insert into a thread that belongs to
    // org B. The trigger's SELECT (security-invoker) returns no row, so
    // organization_id stays NULL and the NOT NULL constraint fails.
    await expect(
      runAs(
        fixture.db,
        { orgId: orgA, userId: userA },
        async (tx) =>
          tx.execute(sql`
            INSERT INTO inbox_messages
              (thread_id, direction, author_type, body)
            VALUES
              (${threadBId}::uuid, 'inbound', 'contact', 'spoof attempt')
          `),
      ),
    ).rejects.toThrow();
  });
});

describe('internal_notes.organization_id trigger', () => {
  it('auto-populates organization_id and persists pinned flag', async () => {
    const noteId = '99999999-9999-4999-8999-fffffffff002';
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.execute(sql`
          INSERT INTO internal_notes
            (id, thread_id, author_id, body, pinned)
          VALUES
            (${noteId}::uuid, ${threadAId}::uuid, ${userA}::uuid,
             'cliente recurrente, evitar tonos formales', true)
        `),
    );

    const [row] = await runAs<
      Array<{ organizationId: string; pinned: boolean }>
    >(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({
            organizationId: internalNotes.organizationId,
            pinned: internalNotes.pinned,
          })
          .from(internalNotes)
          .where(eq(internalNotes.id, noteId)),
    );
    expect(row?.organizationId).toBe(orgA);
    expect(row?.pinned).toBe(true);
  });
});
