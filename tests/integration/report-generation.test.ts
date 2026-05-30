import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAsOrg } from '../../lib/db/client';
import {
  adsAccounts,
  adsSpendDaily,
  organizations,
  plans,
  reviews,
  scheduledReports,
  users,
} from '../../lib/db/schema';
import {
  runDispatchScheduledReports,
  type DispatchScheduledReportsDeps,
} from '../../lib/inngest/functions/dispatch-scheduled-reports';
import {
  generateAndDeliverReport,
  type GenerateReportDeps,
} from '../../lib/reports/pdf/generate-report';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C52 report generation + scheduling. pglite + RLS; storage + email injected as
 * spies (no R2 / Resend). Proves: the PDF is rendered with the org's branding,
 * stored under an org-scoped key, and emailed per recipient; and that the
 * scheduler dispatches due reports + advances next_run_at.
 */

let fixture: TestDb;
const NOW = new Date('2026-05-30T12:00:00Z');
const planId = '00000000-0000-4000-8000-c52900000001';
const orgA = '11111111-1111-4111-8111-c52900000001';
const userA = '22222222-2222-4222-8222-c52900000001';
const acct = '33333333-3333-4333-8333-c52900000001';
const sched = '66666666-6666-4666-8666-c52900000001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(users).values({ id: userA, email: 'a@c529.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Org A',
      slug: 'c529-org-a',
      planId,
      displayName: 'Brandy Co',
      primaryColor: '#112233',
      locale: 'en',
    });
    await tx.insert(adsAccounts).values({
      id: acct,
      organizationId: orgA,
      platform: 'meta',
      externalAccountId: 'act1',
      currency: 'USD',
      status: 'connected',
    });
    await tx.insert(adsSpendDaily).values({
      organizationId: orgA,
      adsAccountId: acct,
      platformCampaignId: 'c1',
      date: '2026-05-10',
      impressions: 1000,
      clicks: 50,
      spendCents: 5000,
      spendUsdCents: 5000,
      conversions: 4,
      currency: 'USD',
    });
    await tx.insert(reviews).values({
      organizationId: orgA,
      platform: 'gbp',
      rating: 5,
      body: 'great',
      status: 'responded',
      postedAt: new Date('2026-05-10'),
    });
    await tx.insert(scheduledReports).values({
      id: sched,
      organizationId: orgA,
      name: 'Weekly',
      kind: 'weekly',
      scheduleExpr: 'mon 09:00',
      recipients: ['ops@brandy.test'],
      status: 'active',
      nextRunAt: new Date('2026-05-01T00:00:00Z'), // due
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('generateAndDeliverReport', () => {
  it('renders a branded PDF, stores it org-scoped, and emails each recipient', async () => {
    let storedKey = '';
    let storedBytes: Uint8Array = new Uint8Array();
    const sent: Array<{ to: string; fromName: string; locale: string; ctaUrl?: string }> = [];
    const deps: GenerateReportDeps = {
      orgTx: (orgId, fn) => runAsOrg(fixture.db, orgId, fn),
      storePdf: async (key, bytes) => {
        storedKey = key;
        storedBytes = bytes;
        return 'https://mock.cdn/report.pdf';
      },
      sendEmail: async (input) => {
        sent.push({ to: input.to, fromName: input.fromName, locale: input.locale, ctaUrl: input.data.ctaUrl });
      },
      now: () => NOW,
      uuid: () => 'fixed-uuid',
    };

    const result = await generateAndDeliverReport(
      { orgId: orgA, periodDays: 30, pillars: ['reviews', 'ads'], recipients: ['a@x.test', 'b@x.test'] },
      deps,
    );

    expect(storedKey).toBe(`orgs/${orgA}/reports/fixed-uuid.pdf`);
    expect(Buffer.from(storedBytes).toString('latin1').startsWith('%PDF')).toBe(true);
    // Branded with the org display name.
    expect(Buffer.from(storedBytes).toString('latin1')).toContain('(Brandy Co) Tj');
    expect(result.emailed).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[0]?.fromName).toBe('Brandy Co');
    expect(sent[0]?.locale).toBe('en');
    expect(sent[0]?.ctaUrl).toBe('https://mock.cdn/report.pdf');
  });
});

describe('runDispatchScheduledReports', () => {
  it('dispatches a due report (emit) and advances next_run_at', async () => {
    let emittedTo: ReadonlyArray<string> | null = null;
    let generateCalled = false;
    const nextDate = new Date('2026-06-06T09:00:00Z');
    const deps: DispatchScheduledReportsDeps = {
      asAdmin: (fn) => runAdmin(fixture.db, fn),
      emit: async (_name, data) => {
        emittedTo = data.recipients;
        return true; // Inngest accepted → no inline generate
      },
      generate: async () => {
        generateCalled = true;
      },
      nextRun: () => nextDate,
      now: () => NOW,
    };

    const report = await runDispatchScheduledReports(deps);
    expect(report.due).toBe(1);
    expect(report.dispatched).toBe(1);
    expect(report.failed).toBe(0);
    expect(emittedTo).toEqual(['ops@brandy.test']);
    expect(generateCalled).toBe(false); // emit succeeded → inline skipped

    const [row] = await runAdmin<Array<{ nextRunAt: Date | null; lastRunAt: Date | null }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ nextRunAt: scheduledReports.nextRunAt, lastRunAt: scheduledReports.lastRunAt })
          .from(scheduledReports)
          .where(eq(scheduledReports.id, sched)),
    );
    expect(row?.nextRunAt?.toISOString()).toBe(nextDate.toISOString());
    expect(row?.lastRunAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('runs generate INLINE when Inngest is off (emit→false); null next keeps current', async () => {
    // Re-arm the schedule as due.
    const due = new Date('2026-05-02T00:00:00Z');
    await runAdmin(fixture.db, (tx) =>
      tx.update(scheduledReports).set({ nextRunAt: due }).where(eq(scheduledReports.id, sched)),
    );

    let generatedPayload: { recipients: ReadonlyArray<string>; periodDays: number; pillars: unknown[] } | null = null;
    const deps: DispatchScheduledReportsDeps = {
      asAdmin: (fn) => runAdmin(fixture.db, fn),
      emit: async () => false, // Inngest off → caller must run inline
      generate: async (payload) => {
        generatedPayload = { recipients: payload.recipients, periodDays: payload.periodDays, pillars: payload.pillars };
      },
      nextRun: () => null, // unparseable → fall back to current next_run_at
      now: () => NOW,
    };

    const report = await runDispatchScheduledReports(deps);
    expect(report.dispatched).toBe(1);
    expect(generatedPayload).not.toBeNull();
    expect(generatedPayload!.recipients).toEqual(['ops@brandy.test']);
    expect(generatedPayload!.periodDays).toBe(7); // weekly
    expect(generatedPayload!.pillars).toHaveLength(4);

    const [row] = await runAdmin<Array<{ nextRunAt: Date | null }>>(fixture.db, (tx) =>
      tx.select({ nextRunAt: scheduledReports.nextRunAt }).from(scheduledReports).where(eq(scheduledReports.id, sched)),
    );
    expect(row?.nextRunAt?.toISOString()).toBe(due.toISOString()); // null next → unchanged
  });
});
