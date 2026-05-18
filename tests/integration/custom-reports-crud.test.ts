import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  customReportWidgets,
  customReports,
  organizationMembers,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  countCustomReportsByOrgWithTx,
  getCustomReportWithWidgetsWithTx,
  listCustomReportsForUserWithTx,
} from '../../lib/custom-reports/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-fff000039001';
const orgId = '11111111-1111-4111-8111-fff000039001';
const userId = '22222222-2222-4222-8222-fff000039001';
const otherUserId = '22222222-2222-4222-8222-fff000039002';

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
      { id: userId, email: 'crud-a@blacknel.test', name: 'CRUD A' },
      { id: otherUserId, email: 'crud-b@blacknel.test', name: 'CRUD B' },
    ]);
    await tx.insert(organizations).values({
      id: orgId,
      name: 'CRUD Org',
      slug: 'crud-org',
      planId,
    });
    await tx.insert(organizationMembers).values([
      {
        organizationId: orgId,
        userId,
        role: 'admin',
        status: 'active',
      },
      {
        organizationId: orgId,
        userId: otherUserId,
        role: 'viewer',
        status: 'active',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('custom_reports CRUD primitives', () => {
  it('insert + count round-trip', async () => {
    const reportId = '55555555-5555-4555-8555-fff000039001';
    await runAs(fixture.db, { orgId, userId }, async (tx) => {
      await tx.insert(customReports).values({
        id: reportId,
        organizationId: orgId,
        name: 'CRUD test',
        status: 'draft',
        shareScope: 'private',
        createdBy: userId,
      });
    });
    const count = await runAs<number>(
      fixture.db,
      { orgId, userId },
      (tx) => countCustomReportsByOrgWithTx(tx, { orgId }),
    );
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('insert widgets + retrieve via getCustomReportWithWidgets', async () => {
    const reportId = '55555555-5555-4555-8555-fff000039002';
    await runAs(fixture.db, { orgId, userId }, async (tx) => {
      await tx.insert(customReports).values({
        id: reportId,
        organizationId: orgId,
        name: 'Widget test',
        status: 'draft',
        shareScope: 'private',
        createdBy: userId,
      });
      await tx.insert(customReportWidgets).values([
        {
          customReportId: reportId,
          kind: 'kpi_card',
          positionRow: 0,
          positionCol: 0,
          width: 3,
          height: 1,
          config: { dataSource: 'inbox_kpis', metric: 'avg_response_time_minutes', label: 'X' },
        },
        {
          customReportId: reportId,
          kind: 'text_block',
          positionRow: 1,
          positionCol: 0,
          width: 12,
          height: 1,
          config: { markdown: 'Hello' },
        },
      ]);
    });

    const loaded = await runAs(
      fixture.db,
      { orgId, userId },
      (tx) => getCustomReportWithWidgetsWithTx(tx, { orgId, reportId }),
    );
    expect(loaded).not.toBeNull();
    expect(loaded?.widgets.length).toBe(2);
    expect(loaded?.widgets[0]?.kind).toBe('kpi_card');
  });

  it('share scope filters list correctly (private hides from other users)', async () => {
    const privateId = '55555555-5555-4555-8555-fff000039003';
    const orgVisibleId = '55555555-5555-4555-8555-fff000039004';

    await runAs(fixture.db, { orgId, userId }, async (tx) => {
      await tx.insert(customReports).values([
        {
          id: privateId,
          organizationId: orgId,
          name: 'Private only mine',
          status: 'draft',
          shareScope: 'private',
          createdBy: userId,
        },
        {
          id: orgVisibleId,
          organizationId: orgId,
          name: 'Org visible',
          status: 'published',
          publishedAt: new Date(),
          shareScope: 'org_visible',
          createdBy: userId,
        },
      ]);
    });

    // From otherUser perspective, private should NOT appear; org_visible SHOULD.
    const listed = await runAs(
      fixture.db,
      { orgId, userId: otherUserId },
      (tx) =>
        listCustomReportsForUserWithTx(tx, {
          orgId,
          userId: otherUserId,
        }),
    );
    const ids = listed.map((r) => r.id);
    expect(ids).toContain(orgVisibleId);
    expect(ids).not.toContain(privateId);
  });

  it('specific_users share lets the listed user in', async () => {
    const specificId = '55555555-5555-4555-8555-fff000039005';

    await runAs(fixture.db, { orgId, userId }, async (tx) => {
      await tx.insert(customReports).values({
        id: specificId,
        organizationId: orgId,
        name: 'Specific share',
        status: 'published',
        publishedAt: new Date(),
        shareScope: 'specific_users',
        sharedWith: [otherUserId],
        createdBy: userId,
      });
    });

    const listed = await runAs(
      fixture.db,
      { orgId, userId: otherUserId },
      (tx) =>
        listCustomReportsForUserWithTx(tx, {
          orgId,
          userId: otherUserId,
        }),
    );
    expect(listed.map((r) => r.id)).toContain(specificId);
  });

  it('list returns widget count from custom_report_widgets aggregation', async () => {
    const listed = await runAs(
      fixture.db,
      { orgId, userId },
      (tx) =>
        listCustomReportsForUserWithTx(tx, {
          orgId,
          userId,
        }),
    );
    const widgetTestRow = listed.find((r) => r.name === 'Widget test');
    expect(widgetTestRow?.widgetCount).toBe(2);
  });
});
