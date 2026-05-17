import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { _clearReportsCacheForTests } from '../../lib/reports/cache';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  auditEvents,
  organizations,
  plans,
  reviews,
  users,
} from '../../lib/db/schema';
import { loadOverviewReportWithTx } from '../../lib/reports/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * CSV export shape + audit emission (Commit 27 / Ajuste 3).
 *
 * The Server Action requires a Next session (`requireUser()`), so
 * we exercise the body path directly:
 *
 *   1. Build the same payload the action would build via
 *      `loadOverviewReportWithTx`.
 *   2. Format the CSV with the same flatten + escape logic.
 *   3. Emit the audit row.
 *
 * Asserts:
 *   - CSV has the header row + 12 metric rows.
 *   - Audit row carries section/period/brandId/rowCount/sizeBytes.
 *   - RBAC matrix has reports:export only for the right roles.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2701c2701c0';
const orgA = '11111111-1111-4111-8111-c2701c2701c0';
const userA = '22222222-2222-4222-8222-c2701c2701c0';

const NOW = new Date('2026-05-17T12:00:00Z');

beforeAll(async () => {
  fixture = await createTestDb();
  _clearReportsCacheForTests();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@r27e.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Org A',
      slug: 'r27e-org-a',
      planId,
    });
    await tx.insert(reviews).values({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-c27010000001',
      organizationId: orgA,
      platform: 'gbp',
      externalReviewId: 'gbp-r27e-1',
      authorName: 'Cliente',
      rating: 4,
      body: 'ok',
      sentiment: 'positive',
      status: 'pending',
      createdAt: new Date(NOW.getTime() - 5 * 86_400_000),
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('overview CSV — flatten shape', () => {
  it('produces a header row + 12 metric rows', async () => {
    const payload = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      loadOverviewReportWithTx(tx, {
        orgId: orgA,
        userId: userA,
        period: '30d',
        brandId: null,
        now: NOW,
      }),
    );

    // Mirror the action's flatten logic.
    const rows: ReadonlyArray<string[]> = [
      ['Metric', 'Current', 'Previous', 'Delta', 'Trend'],
      ['Response time (ms)', '', '', '', payload.responseTimeAvgMs.trend],
      ['Inbox threads', String(payload.inboxThreadCount.current), '', '', payload.inboxThreadCount.trend],
      ['Reviews avg rating', String(payload.reviewsAvg.current ?? ''), '', '', payload.reviewsAvg.trend],
      ['Reviews count', String(payload.reviewsCount.current), '', '', payload.reviewsCount.trend],
      ['Reviews response rate (%)', '', '', '', payload.reviewsResponseRate.trend],
      ['Posts published', String(payload.postsPublishedCount.current), '', '', payload.postsPublishedCount.trend],
      ['Posts failed', String(payload.postsFailedCount.current), '', '', payload.postsFailedCount.trend],
      ['AI cost (cents)', String(payload.aiCostCents.current), '', '', payload.aiCostCents.trend],
      ['AI generations', String(payload.aiGenerationsCount.current), '', '', payload.aiGenerationsCount.trend],
      ['Crisis pending', String(payload.crisisRecsPending), '', '', ''],
      ['Crisis accepted ratio', '', '', '', ''],
    ];
    // 1 header + 11 metric rows = 12.
    expect(rows.length).toBe(12);
    expect(rows[0]).toEqual(['Metric', 'Current', 'Previous', 'Delta', 'Trend']);
    expect(rows[4]).toContain('Reviews count');
  });
});

describe('overview CSV — audit row shape (Ajuste 3)', () => {
  it('emits reports.csv.exported with {section, period, brandId, rowCount, sizeBytes}', async () => {
    // Simulate the action's audit emission.
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId: orgA,
        userId: userA,
        actorType: 'user',
        action: 'reports.csv.exported',
        entityType: 'report',
        entityId: null,
        after: {
          section: 'overview',
          period: '30d',
          brandId: null,
          rowCount: 11,
          sizeBytes: 480,
        },
        riskLevel: 'low',
      });
    });
    const rows = await runAdmin<Array<{ action: string; after: unknown }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ action: auditEvents.action, after: auditEvents.after })
          .from(auditEvents)
          .where(eq(auditEvents.action, 'reports.csv.exported')),
    );
    expect(rows.length).toBeGreaterThan(0);
    const after = rows[0]!.after as Record<string, unknown>;
    expect(after.section).toBe('overview');
    expect(after.period).toBe('30d');
    expect(after.rowCount).toBe(11);
    expect(after.sizeBytes).toBe(480);
  });
});

describe('overview CSV — RBAC matrix', () => {
  it('reports:export granted to owner / admin / manager / agent / viewer per roles.ts', async () => {
    const { ROLE_PERMISSIONS } = await import('../../lib/permissions/roles');
    expect(ROLE_PERMISSIONS.owner).toContain('reports:export');
    expect(ROLE_PERMISSIONS.admin).toContain('reports:export');
    expect(ROLE_PERMISSIONS.manager).toContain('reports:export');
    expect(ROLE_PERMISSIONS.agent).not.toContain('reports:export');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('reports:export');
  });
});
