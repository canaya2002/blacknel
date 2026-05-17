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
import { loadInboxReportWithTx } from '../../lib/reports/inbox-queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * /reports Inbox tab (Phase 8 / Commit 30).
 *
 *   1. Empty org → 0 / null / flat trends.
 *   2. Seeded threads + messages → counts + p50 + AI ratio
 *      match expected math.
 *   3. Brand filter is a no-op (inbox has no brand_id).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3020c3020c0';
const orgA = '11111111-1111-4111-8111-c3020c3020c0';
const userA = '22222222-2222-4222-8222-c3020c3020c0';

const NOW = new Date('2026-05-17T12:00:00Z');
const dayMs = 86_400_000;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@c30i.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Org A',
      slug: 'c30i-org-a',
      planId,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('loadInboxReportWithTx — empty org', () => {
  it('returns 0 counts, null p50, 0% ai ratio', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadInboxReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.threadsOpened.current).toBe(0);
    expect(payload.threadsClosed.current).toBe(0);
    expect(payload.responseTimeP50Ms.current).toBeNull();
    expect(payload.aiAssistedReplyRatio.current).toBe(0);
  });
});

describe('loadInboxReportWithTx — seeded data', () => {
  beforeAll(async () => {
    await runAdmin(fixture.db, async (tx) => {
      const contactId = 'dddddddd-dddd-4ddd-8ddd-c3020c3020c0';
      await tx.insert(contactProfiles).values({
        id: contactId,
        organizationId: orgA,
        platform: 'facebook',
        externalId: 'fb-c30i',
        displayName: 'Customer',
      });
      // 3 threads: 2 in current window (one closed), 1 in prev.
      await tx.insert(inboxThreads).values([
        {
          id: 'eeeeeeee-eeee-4eee-8eee-c3020c3020c0',
          organizationId: orgA,
          contactProfileId: contactId,
          platform: 'facebook',
          kind: 'dm',
          externalThreadId: 'thr-cur-1',
          lastMessageAt: new Date(NOW.getTime() - 5 * dayMs),
          status: 'open',
          createdAt: new Date(NOW.getTime() - 5 * dayMs),
        },
        {
          id: 'eeeeeeee-eeee-4eee-8eee-c3020c3020c1',
          organizationId: orgA,
          contactProfileId: contactId,
          platform: 'facebook',
          kind: 'dm',
          externalThreadId: 'thr-cur-2',
          lastMessageAt: new Date(NOW.getTime() - 3 * dayMs),
          status: 'closed',
          closedAt: new Date(NOW.getTime() - 2 * dayMs),
          createdAt: new Date(NOW.getTime() - 3 * dayMs),
        },
        {
          id: 'eeeeeeee-eeee-4eee-8eee-c3020c3020c2',
          organizationId: orgA,
          contactProfileId: contactId,
          platform: 'facebook',
          kind: 'dm',
          externalThreadId: 'thr-prev',
          lastMessageAt: new Date(NOW.getTime() - 40 * dayMs),
          status: 'open',
          createdAt: new Date(NOW.getTime() - 40 * dayMs),
        },
      ]);

      // Outbound messages: 2 in current window (1 ai, 1 user)
      // → 50% AI ratio. One inbound+outbound pair on thread cur-1
      // with 1h gap → p50 ≈ 3.6M ms.
      const inboundAt = new Date(NOW.getTime() - 5 * dayMs);
      const outboundAt = new Date(inboundAt.getTime() + 60 * 60_000);
      await tx.insert(inboxMessages).values([
        {
          id: 'ffffffff-ffff-4fff-8fff-c3020c3020c0',
          organizationId: orgA,
          threadId: 'eeeeeeee-eeee-4eee-8eee-c3020c3020c0',
          direction: 'inbound',
          authorType: 'contact',
          body: 'Hola',
          sentAt: inboundAt,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-c3020c3020c1',
          organizationId: orgA,
          threadId: 'eeeeeeee-eeee-4eee-8eee-c3020c3020c0',
          direction: 'outbound',
          authorType: 'ai',
          body: 'Respuesta AI',
          sentAt: outboundAt,
        },
        {
          id: 'ffffffff-ffff-4fff-8fff-c3020c3020c2',
          organizationId: orgA,
          threadId: 'eeeeeeee-eeee-4eee-8eee-c3020c3020c1',
          direction: 'outbound',
          authorType: 'user',
          body: 'Respuesta humana',
          sentAt: new Date(NOW.getTime() - 2 * dayMs),
        },
      ]);
    });
  });

  it('threadsOpened=2 current, threadsClosed=1, p50≈3.6M ms, ai ratio=50%', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadInboxReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );
    expect(payload.threadsOpened.current).toBe(2);
    expect(payload.threadsClosed.current).toBe(1);
    expect(payload.responseTimeP50Ms.current).toBeCloseTo(3_600_000, -4);
    expect(payload.aiAssistedReplyRatio.current).toBeCloseTo(50, 0);
  });

  it('brand filter is a no-op — same payload regardless of brandId', async () => {
    const withBrand = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadInboxReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: '99999999-9999-4999-8999-999999999999',
        now: NOW,
      }),
    );
    expect(withBrand.threadsOpened.current).toBe(2);
    expect(withBrand.aiAssistedReplyRatio.current).toBeCloseTo(50, 0);
  });
});
