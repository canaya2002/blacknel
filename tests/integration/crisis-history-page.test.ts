import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import { listCrisisRecommendationsWithTx } from '../../lib/ai/recommendations';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  aiRecommendations,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Crisis history page data path (Commit 25 / Ajuste 2).
 *
 * Verifies the /reputation/crisis/history page loader:
 *   1. Returns only accepted+dismissed rows (status filter works).
 *   2. Orders DESC by created_at (newest first).
 *   3. Respects since filter (90-day lookback).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2503c2503c0';
const orgA = '11111111-1111-4111-8111-c2503c2503c0';
const userA = '22222222-2222-4222-8222-c2503c2503c0';

beforeAll(async () => {
  fixture = await createTestDb();
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
    await tx.insert(users).values({ id: userA, email: 'a@c25h.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'History Org',
      slug: 'c25h-org-a',
      planId,
    });

    // 4 recs total: 1 pending, 1 accepted, 1 dismissed, 1 ancient.
    const now = new Date();
    const ancient = new Date(now.getTime() - 120 * 86_400_000);
    await tx.insert(aiRecommendations).values([
      {
        id: '99999999-9999-4999-8999-c2503c2503e1',
        organizationId: orgA,
        category: 'crisis',
        title: 'Pending one',
        body: 'pending',
        status: 'pending',
        evidence: { reviewIds: [], messageIds: [], severity: 'medium' },
      },
      {
        id: '99999999-9999-4999-8999-c2503c2503e2',
        organizationId: orgA,
        category: 'crisis',
        title: 'Accepted one',
        body: 'accepted',
        status: 'accepted',
        evidence: { reviewIds: [], messageIds: [], severity: 'high' },
        decidedAt: new Date(now.getTime() - 86_400_000),
        decidedBy: userA,
      },
      {
        id: '99999999-9999-4999-8999-c2503c2503e3',
        organizationId: orgA,
        category: 'crisis',
        title: 'Dismissed one',
        body: 'dismissed',
        status: 'dismissed',
        evidence: {
          reviewIds: [],
          messageIds: [],
          severity: 'low',
          decisionReason: 'Seasonal noise',
        },
        decidedAt: new Date(now.getTime() - 2 * 86_400_000),
        decidedBy: userA,
      },
      {
        id: '99999999-9999-4999-8999-c2503c2503e4',
        organizationId: orgA,
        category: 'crisis',
        title: 'Ancient one (>90d)',
        body: 'ancient',
        status: 'accepted',
        evidence: { reviewIds: [], messageIds: [], severity: 'critical' },
        decidedAt: ancient,
        decidedBy: userA,
        createdAt: ancient,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  await fixture.dispose();
});

describe('/reputation/crisis/history — list filter + ordering', () => {
  it('returns only accepted + dismissed rows from the last 90 days', async () => {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const rows = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listCrisisRecommendationsWithTx(tx, {
        orgId: orgA,
        userId: userA,
        status: ['accepted', 'dismissed'],
        since,
      }),
    );
    // Should NOT include pending and NOT include the 120-day-old.
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.status === 'accepted' || r.status === 'dismissed')).toBe(
      true,
    );
    expect(rows.find((r) => r.title === 'Ancient one (>90d)')).toBeUndefined();
    expect(rows.find((r) => r.title === 'Pending one')).toBeUndefined();
  });

  it('orders by created_at DESC (newest first)', async () => {
    const since = new Date(Date.now() - 90 * 86_400_000);
    const rows = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listCrisisRecommendationsWithTx(tx, {
        orgId: orgA,
        userId: userA,
        status: ['accepted', 'dismissed'],
        since,
      }),
    );
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        rows[i + 1]!.createdAt.getTime(),
      );
    }
  });
});
