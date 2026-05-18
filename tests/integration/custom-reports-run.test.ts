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
import { runCustomReportWithTx } from '../../lib/custom-reports/run';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-fff000039101';
const orgId = '11111111-1111-4111-8111-fff000039101';
const userId = '22222222-2222-4222-8222-fff000039101';
const reportId = '55555555-5555-4555-8555-fff000039101';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({
      id: userId,
      email: 'run@blacknel.test',
      name: 'Run User',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Run Org',
      slug: 'run-org',
      planId,
    });
    await tx.insert(organizationMembers).values({
      organizationId: orgId,
      userId,
      role: 'admin',
      status: 'active',
    });
    await tx.insert(customReports).values({
      id: reportId,
      organizationId: orgId,
      name: 'Run test report',
      status: 'published',
      publishedAt: new Date(),
      shareScope: 'private',
      createdBy: userId,
    });
    // 2 widgets: 1 text_block (no data), 1 KPI on inbox_kpis
    await tx.insert(customReportWidgets).values([
      {
        customReportId: reportId,
        kind: 'text_block',
        positionRow: 0,
        positionCol: 0,
        width: 12,
        height: 1,
        config: { markdown: '**Run test**', heading: 'Header' },
      },
      {
        customReportId: reportId,
        kind: 'kpi_card',
        positionRow: 1,
        positionCol: 0,
        width: 3,
        height: 1,
        config: {
          dataSource: 'inbox_kpis',
          metric: 'threads_pending_approval_count',
          label: 'Pending',
          format: 'number',
        },
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runCustomReportWithTx', () => {
  it('returns composite payload with one entry per widget', async () => {
    const now = new Date();
    const result = await runAs(fixture.db, { orgId, userId }, (tx) =>
      runCustomReportWithTx(tx, {
        orgId,
        userId,
        reportId,
        rangeStart: new Date(now.getTime() - 30 * 86_400_000),
        rangeEnd: now,
      }),
    );
    expect(result.widgets).toHaveLength(2);
    expect(result.reportId).toBe(reportId);
    expect(result.status).toBe('published');
  });

  it('text_block widget renders safe HTML (markdown converted)', async () => {
    const now = new Date();
    const result = await runAs(fixture.db, { orgId, userId }, (tx) =>
      runCustomReportWithTx(tx, {
        orgId,
        userId,
        reportId,
        rangeStart: new Date(now.getTime() - 30 * 86_400_000),
        rangeEnd: now,
      }),
    );
    const text = result.widgets.find((w) => w.kind === 'text_block');
    expect(text?.payload).toBeDefined();
    if (text?.payload && 'safeHtml' in text.payload) {
      expect(text.payload.safeHtml).toContain('<strong>Run test</strong>');
      expect(text.payload.heading).toBe('Header');
    }
  });

  it('throws when reportId does not exist in org', async () => {
    const now = new Date();
    await expect(
      runAs(fixture.db, { orgId, userId }, (tx) =>
        runCustomReportWithTx(tx, {
          orgId,
          userId,
          reportId: '55555555-5555-4555-8555-fff000039199',
          rangeStart: new Date(now.getTime() - 30 * 86_400_000),
          rangeEnd: now,
        }),
      ),
    ).rejects.toThrow();
  });
});
