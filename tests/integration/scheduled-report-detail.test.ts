import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  organizations,
  plans,
  scheduledReportRuns,
  scheduledReports,
  users,
} from '../../lib/db/schema';
import {
  getScheduledReportByIdWithTx,
  listRunsForReportWithTx,
} from '../../lib/scheduled-reports/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 35 — `/reports/scheduled/[id]` detail page
 * underlying queries.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3501c3501c0';
const orgId = '11111111-1111-4111-8111-c3501c3501c0';
const userId = '22222222-2222-4222-8222-c3501c3501c0';
const reportId = '99999999-9999-4999-8999-c3501c3501c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values({
      id: userId,
      email: 'a@c3501.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'SR Detail Org',
      slug: 'c3501-sr',
      planId,
    });
    await tx.insert(scheduledReports).values({
      id: reportId,
      organizationId: orgId,
      name: 'Weekly overview',
      kind: 'weekly',
      scheduleExpr: 'mon 09:00',
      recipients: ['a@c3501.test', 'b@c3501.test'],
      status: 'active',
      nextRunAt: new Date('2026-05-25T15:00:00Z'),
      lastRunAt: new Date('2026-05-18T15:00:00Z'),
    });
    // Insert 3 historical runs.
    await tx.insert(scheduledReportRuns).values([
      {
        organizationId: orgId,
        scheduledReportId: reportId,
        status: 'sent',
        generatedAt: new Date('2026-05-18T15:00:00Z'),
        sentAt: new Date('2026-05-18T15:00:01Z'),
        htmlSizeBytes: 4200,
        recipientsCount: 2,
      },
      {
        organizationId: orgId,
        scheduledReportId: reportId,
        status: 'failed',
        errorCode: 'SCHEDULE_PARSE_FAILED',
        errorMessage: 'Cannot compute next run for "bad expr"',
        recipientsCount: 2,
      },
      {
        organizationId: orgId,
        scheduledReportId: reportId,
        status: 'sent',
        generatedAt: new Date('2026-05-11T15:00:00Z'),
        sentAt: new Date('2026-05-11T15:00:02Z'),
        htmlSizeBytes: 4100,
        recipientsCount: 2,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('getScheduledReportById + listRunsForReport', () => {
  it('returns the report + runsCount aggregate', async () => {
    const r = await asAdminTx((tx) =>
      getScheduledReportByIdWithTx(tx, orgId, reportId),
    );
    expect(r).not.toBeNull();
    expect(r!.name).toBe('Weekly overview');
    expect(r!.runsCount).toBe(3);
    expect(r!.recipients).toHaveLength(2);
  });

  it('returns null for an unknown id', async () => {
    const r = await asAdminTx((tx) =>
      getScheduledReportByIdWithTx(
        tx,
        orgId,
        '00000000-0000-4000-8000-000000009999',
      ),
    );
    expect(r).toBeNull();
  });

  it('runs list is ordered most-recent first + carries error fields on failed', async () => {
    const runs = await asAdminTx((tx) =>
      listRunsForReportWithTx(tx, orgId, reportId, 10),
    );
    expect(runs).toHaveLength(3);
    // Most-recent-first.
    for (let i = 1; i < runs.length; i += 1) {
      expect(runs[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        runs[i]!.createdAt.getTime(),
      );
    }
    const failed = runs.find((r) => r.status === 'failed');
    expect(failed).toBeDefined();
    expect(failed!.errorCode).toBe('SCHEDULE_PARSE_FAILED');
  });

  it('listRunsForReport limit caps the result set', async () => {
    const runs = await asAdminTx((tx) =>
      listRunsForReportWithTx(tx, orgId, reportId, 1),
    );
    expect(runs).toHaveLength(1);
  });
});
