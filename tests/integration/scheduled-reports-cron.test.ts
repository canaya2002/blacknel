import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  auditEvents,
  organizations,
  plans,
  scheduledReportRuns,
  scheduledReports,
  users,
} from '../../lib/db/schema';
import {
  runScheduledReportsTick,
  type ScheduledReportsTickDeps,
} from '../../lib/jobs/scheduled-reports-tick';
import { clearDevOutbox, getDevOutbox } from '../../lib/emails/dev-outbox';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 34 — cron dispatcher behavior.
 *
 *   - Picks up due rows + dispatches each.
 *   - Creates `scheduled_report_runs` rows.
 *   - Emits `scheduled_report.dispatched` audit (Ajuste B).
 *   - Recomputes `next_run_at` respecting org timezone.
 *   - Pushes HTML email to the dev outbox.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3420c3420c0';
const orgId = '11111111-1111-4111-8111-c3420c3420c0';
const userId = '22222222-2222-4222-8222-c3420c3420c0';
const reportDue = '99999999-9999-4999-8999-c3420c3420c0';

const deps: ScheduledReportsTickDeps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) =>
    runAdmin(fixture.db, fn),
};

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
      email: 'a@c3420.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Cron Org',
      slug: 'c3420-cron',
      planId,
      timezone: 'America/Mexico_City',
    });
    await tx.insert(scheduledReports).values({
      id: reportDue,
      organizationId: orgId,
      name: 'Weekly overview',
      kind: 'weekly',
      scheduleExpr: 'mon 09:00',
      recipients: ['reporting@c3420.test', 'second@c3420.test'],
      status: 'active',
      nextRunAt: new Date('2026-05-19T09:00:00Z'),
    });
    clearDevOutbox();
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runScheduledReportsTick', () => {
  it('dispatches a due row + writes audit + pushes per-recipient email', async () => {
    const now = new Date('2026-05-20T12:00:00Z');
    clearDevOutbox();
    const result = await runScheduledReportsTick({ now, deps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.considered).toBe(1);
    expect(result.data.dispatched).toBe(1);

    // Run row written + marked sent.
    type RunRow = { status: string; htmlSizeBytes: number | null };
    const runs = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          status: scheduledReportRuns.status,
          htmlSizeBytes: scheduledReportRuns.htmlSizeBytes,
        })
        .from(scheduledReportRuns)
        .where(eq(scheduledReportRuns.scheduledReportId, reportDue)),
    )) as RunRow[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('sent');
    expect(runs[0]!.htmlSizeBytes).not.toBeNull();
    expect(runs[0]!.htmlSizeBytes!).toBeGreaterThan(0);

    // Two recipients → two outbox entries.
    const outbox = getDevOutbox().filter(
      (m) => m.kind === 'scheduled_report',
    );
    expect(outbox.length).toBeGreaterThanOrEqual(2);
    expect(outbox.every((m) => typeof m.html === 'string' && m.html.length > 0)).toBe(true);

    // Audit event emitted (Ajuste B).
    type AuditRow = { action: string };
    const audits = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, reportDue)),
    )) as AuditRow[];
    const dispatched = audits.filter(
      (a) => a.action === 'scheduled_report.dispatched',
    );
    expect(dispatched.length).toBeGreaterThanOrEqual(1);
  });

  it('recomputes next_run_at respecting the org timezone (R-34-1)', async () => {
    type Row = { nextRunAt: Date };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ nextRunAt: scheduledReports.nextRunAt })
        .from(scheduledReports)
        .where(eq(scheduledReports.id, reportDue)),
    )) as Row[];
    const next = rows[0]!.nextRunAt;
    // The previous run fired on `now = 2026-05-20T12:00Z`. Next
    // "mon 09:00" CDMX after that is Mon 2026-05-25 09:00 CDMX =
    // 15:00 UTC.
    expect(next.toISOString()).toBe('2026-05-25T15:00:00.000Z');
  });

  it('no-op when no rows are due', async () => {
    // After the first run, next_run_at is in the future → no due.
    const now = new Date('2026-05-20T12:01:00Z');
    const result = await runScheduledReportsTick({ now, deps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.considered).toBe(0);
    expect(result.data.dispatched).toBe(0);
  });
});
