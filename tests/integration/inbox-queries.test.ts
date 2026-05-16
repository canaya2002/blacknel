import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  contactProfiles,
  inboxMessages,
  inboxThreads,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { decodeThreadCursor } from '../../lib/inbox/cursor';
import { listThreadsWithTx } from '../../lib/inbox/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Integration coverage for `listThreadsWithTx`. We seed a deterministic
 * mini-world directly through `runAdmin` (RLS bypassed for setup), then
 * exercise the query through `runAs` so RLS evaluates the same way the
 * production `dbAs` path does.
 *
 * What we lock in:
 *
 *   1. Filters: status, priority, platform, assignedTo (= me / unassigned).
 *   2. Cursor pagination: page 1 + page 2 covers every row exactly once,
 *      in stable order.
 *   3. Tenant isolation: a thread in org B never appears for an org A
 *      session, regardless of filters.
 *   4. Full-text search: tsvector matches body content.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-fc0000000001';
const orgA = '11111111-1111-4111-8111-fc0000000001';
const orgB = '11111111-1111-4111-8111-fc0000000002';
const userA = '22222222-2222-4222-8222-fc0000000001';
const userB = '22222222-2222-4222-8222-fc0000000002';

const orgATotal = 12; // 12 threads in org A
const orgBTotal = 3; // 3 threads in org B (RLS smoke)

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
      { id: userA, email: 'a@q.test', name: 'A' },
      { id: userB, email: 'b@q.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Q Org A', slug: 'q-org-a', planId },
      { id: orgB, name: 'Q Org B', slug: 'q-org-b', planId },
    ]);

    // One contact in each org so the LEFT JOIN has data to verify.
    await tx.insert(contactProfiles).values([
      {
        id: 'cccccccc-cccc-4ccc-8ccc-fc0000000001',
        organizationId: orgA,
        platform: 'facebook',
        externalId: 'fb-contact-A',
        displayName: 'Ana López',
        handle: '@ana.lopez',
      },
      {
        id: 'cccccccc-cccc-4ccc-8ccc-fc0000000002',
        organizationId: orgB,
        platform: 'instagram',
        externalId: 'ig-contact-B',
        displayName: 'B Customer',
        handle: '@b.cust',
      },
    ]);

    // 12 threads in org A, alternating platforms / statuses / priorities /
    // assignment, last_message_at stepping back one hour each.
    const base = new Date('2026-05-15T16:00:00Z').getTime();
    const platforms = ['facebook', 'instagram', 'gbp', 'whatsapp', 'tiktok', 'linkedin'] as const;
    const statuses = ['open', 'pending', 'closed', 'open'] as const;
    const priorities = ['normal', 'urgent', 'normal', 'high'] as const;
    const threadInserts: Array<typeof inboxThreads.$inferInsert> = [];
    for (let i = 0; i < orgATotal; i++) {
      threadInserts.push({
        id: `dddddddd-dddd-4ddd-8ddd-fc${String(i).padStart(10, '0')}`,
        organizationId: orgA,
        platform: platforms[i % platforms.length]!,
        contactProfileId: 'cccccccc-cccc-4ccc-8ccc-fc0000000001',
        kind: 'dm',
        status: statuses[i % statuses.length]!,
        priority: priorities[i % priorities.length]!,
        sentiment: 'neutral',
        assignedTo: i % 3 === 0 ? null : userA, // unassigned every 3rd
        subject: i === 0 ? 'Pregunta sobre reembolso' : `Thread ${i}`,
        lastMessageAt: new Date(base - i * 3600 * 1000),
      });
    }
    for (let i = 0; i < orgBTotal; i++) {
      threadInserts.push({
        id: `eeeeeeee-eeee-4eee-8eee-fc${String(i).padStart(10, '0')}`,
        organizationId: orgB,
        platform: 'instagram',
        contactProfileId: 'cccccccc-cccc-4ccc-8ccc-fc0000000002',
        kind: 'dm',
        status: 'open',
        priority: 'normal',
        sentiment: 'neutral',
        assignedTo: userB,
        subject: `OrgB ${i}`,
        lastMessageAt: new Date(base - (orgATotal + i) * 3600 * 1000),
      });
    }
    await tx.insert(inboxThreads).values(threadInserts);

    // One inbound message per thread; thread 0 mentions "reembolso" for FTS.
    const messageInserts: Array<typeof inboxMessages.$inferInsert> = [];
    threadInserts.forEach((t, i) => {
      messageInserts.push({
        organizationId: t.organizationId,
        threadId: t.id!,
        direction: 'inbound',
        authorType: 'contact',
        body:
          t.id === 'dddddddd-dddd-4ddd-8ddd-fc0000000000'
            ? 'Necesito un reembolso urgente por favor.'
            : `Hola, mensaje para thread ${i}.`,
        sentAt: t.lastMessageAt!,
      });
    });
    await tx.insert(inboxMessages).values(messageInserts);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('listThreadsWithTx — basic listing', () => {
  it('returns org A threads only for an org A session, in DESC last_message_at order', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.threads.length).toBe(orgATotal);
    // First thread is the most recent (i=0).
    expect(page.threads[0]?.id).toBe('dddddddd-dddd-4ddd-8ddd-fc0000000000');
    // No org B leakage.
    expect(page.threads.every((t) => t.id.startsWith('dddddddd'))).toBe(true);
    // No further pages.
    expect(page.nextCursor).toBeNull();
  });

  it('hydrates contact name + handle from the LEFT JOIN', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 1,
        }),
    );
    expect(page.threads[0]?.contactName).toBe('Ana López');
    expect(page.threads[0]?.contactHandle).toBe('@ana.lopez');
  });

  it('snippet pulls the most recent message body', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 1,
        }),
    );
    expect(page.threads[0]?.snippet).toContain('reembolso');
  });
});

describe('listThreadsWithTx — filters', () => {
  it('filters by status (multi-value)', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { status: ['closed'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.threads.every((t) => t.status === 'closed')).toBe(true);
    expect(page.threads.length).toBeGreaterThan(0);
  });

  it('filters by priority urgent', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { priority: ['urgent'] },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.threads.every((t) => t.priority === 'urgent')).toBe(true);
  });

  it('filters by assignedTo=me using session userId', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { assignedTo: 'me' },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.threads.every((t) => t.assignedTo === userA)).toBe(true);
  });

  it('filters by assignedTo=unassigned returns only NULL-assigned threads', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { assignedTo: 'unassigned' },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.threads.every((t) => t.assignedTo === null)).toBe(true);
    expect(page.threads.length).toBeGreaterThan(0);
  });

  it('full-text search on message body finds the relevant thread', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { q: 'reembolso' },
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.threads.length).toBe(1);
    expect(page.threads[0]?.id).toBe('dddddddd-dddd-4ddd-8ddd-fc0000000000');
  });

  it('full-text search with SQL-shaped input does not error or match everything', async () => {
    // plainto_tsquery strips operators — the raw string can't form a
    // tsquery that matches more than literal tokens.
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: { q: "'; drop table inbox_threads; --" },
          cursor: null,
          pageSize: 50,
        }),
    );
    // None of the seeded message bodies contain these literal tokens.
    expect(page.threads.length).toBe(0);
  });
});

describe('listThreadsWithTx — cursor pagination', () => {
  it('paginates through every row exactly once with no overlap', async () => {
    const pageSize = 5;
    const seen: string[] = [];

    let cursor: ReturnType<typeof decodeThreadCursor> = null;
    for (let i = 0; i < 5; i++) {
      const page = await runAs(
        fixture.db,
        { orgId: orgA, userId: userA },
        async (tx) =>
          listThreadsWithTx(tx, {
            orgId: orgA,
            userId: userA,
            filters: {},
            cursor,
            pageSize,
          }),
      );
      seen.push(...page.threads.map((t) => t.id));
      if (!page.nextCursor) break;
      cursor = decodeThreadCursor(page.nextCursor);
    }

    // Exactly orgATotal rows seen, no duplicates.
    expect(seen.length).toBe(orgATotal);
    expect(new Set(seen).size).toBe(orgATotal);
  });

  it('emits a nextCursor only when there is a next page', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 5,
        }),
    );
    expect(page.threads.length).toBe(5);
    expect(page.nextCursor).not.toBeNull();
  });
});

describe('listThreadsWithTx — tenant isolation', () => {
  it('org B threads are invisible to an org A session even without filters', async () => {
    const page = await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        listThreadsWithTx(tx, {
          orgId: orgA,
          userId: userA,
          filters: {},
          cursor: null,
          pageSize: 50,
        }),
    );
    expect(page.threads.every((t) => !t.id.startsWith('eeeeeeee'))).toBe(true);
  });
});
