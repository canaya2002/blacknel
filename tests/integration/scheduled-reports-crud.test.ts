import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  organizations,
  plans,
  scheduledReports,
  users,
} from '../../lib/db/schema';
import { findDueScheduledReportsWithTx } from '../../lib/scheduled-reports/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 34 — scheduled_reports CRUD + due selector.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3410c3410c0';
const orgId = '11111111-1111-4111-8111-c3410c3410c0';
const userId = '22222222-2222-4222-8222-c3410c3410c0';

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
      email: 'a@c3410.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'SR Org',
      slug: 'c3410-sr',
      planId,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('scheduled_reports CRUD', () => {
  it('insert + select an active row', async () => {
    const reportId = '99999999-9999-4999-8999-c3410c3410c0';
    await asAdminTx((tx) =>
      tx.insert(scheduledReports).values({
        id: reportId,
        organizationId: orgId,
        name: 'Weekly overview',
        kind: 'weekly',
        scheduleExpr: 'mon 09:00',
        recipients: ['a@c3410.test'],
        status: 'active',
        nextRunAt: new Date('2026-05-25T15:00:00Z'),
      }),
    );
    type Row = { id: string; status: string };
    const rows = (await asAdminTx((tx) =>
      tx
        .select({
          id: scheduledReports.id,
          status: scheduledReports.status,
        })
        .from(scheduledReports)
        .where(eq(scheduledReports.id, reportId)),
    )) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('active');
  });

  it('CHECK rejects empty recipients', async () => {
    await expect(
      asAdminTx((tx) =>
        tx.insert(scheduledReports).values({
          organizationId: orgId,
          name: 'Empty',
          kind: 'weekly',
          scheduleExpr: 'mon 09:00',
          recipients: [],
          nextRunAt: new Date(),
        }),
      ),
    ).rejects.toThrow();
  });

  it('due selector returns rows whose next_run_at <= now and status=active', async () => {
    const due = '99999999-9999-4999-8999-c3410c3410c1';
    const notDue = '99999999-9999-4999-8999-c3410c3410c2';
    const paused = '99999999-9999-4999-8999-c3410c3410c3';
    const now = new Date('2026-05-20T12:00:00Z');
    await asAdminTx(async (tx) => {
      await tx.insert(scheduledReports).values([
        {
          id: due,
          organizationId: orgId,
          name: 'Due',
          kind: 'weekly',
          scheduleExpr: 'mon 09:00',
          recipients: ['x@x.com'],
          status: 'active',
          nextRunAt: new Date('2026-05-19T09:00:00Z'),
        },
        {
          id: notDue,
          organizationId: orgId,
          name: 'Future',
          kind: 'weekly',
          scheduleExpr: 'mon 09:00',
          recipients: ['x@x.com'],
          status: 'active',
          nextRunAt: new Date('2026-05-25T09:00:00Z'),
        },
        {
          id: paused,
          organizationId: orgId,
          name: 'Paused',
          kind: 'weekly',
          scheduleExpr: 'mon 09:00',
          recipients: ['x@x.com'],
          status: 'paused',
          nextRunAt: new Date('2026-05-18T09:00:00Z'),
        },
      ]);
    });
    const dueRows = await asAdminTx((tx) =>
      findDueScheduledReportsWithTx(tx, now, 50),
    );
    const dueIds = new Set(dueRows.map((r) => r.id));
    expect(dueIds.has(due)).toBe(true);
    expect(dueIds.has(notDue)).toBe(false);
    expect(dueIds.has(paused)).toBe(false);
  });
});
