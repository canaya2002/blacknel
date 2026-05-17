import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  adsAccounts,
  adsAlerts,
  adsSpendDaily,
  auditEvents,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { runAdsAlertsScanTick } from '../../lib/jobs/ads-alerts-scan';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Producer integration (Phase 8 / Commit 29).
 *
 *   1. Small account < floor → no alert.
 *   2. Healthy big account with genuine CTR drop → pending alert.
 *   3. Re-tick within 48h with same evidence → no duplicate.
 *   4. Severity escalation when evidence worsens.
 *   5. Tenant isolation.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2900c2900c0';
const orgA = '11111111-1111-4111-8111-c2900c2900c0';
const orgB = '11111111-1111-4111-8111-c2900c2900c1';
const userA = '22222222-2222-4222-8222-c2900c2900c0';
const userB = '22222222-2222-4222-8222-c2900c2900c1';

const smallAcc = '33333333-3333-4333-8333-c2900c2900c0';
const bigAcc = '33333333-3333-4333-8333-c2900c2900c1';
const orgBAcc = '33333333-3333-4333-8333-c2900c2900c2';

const NOW = new Date('2026-05-17T12:00:00Z');
const dayMs = 86_400_000;

const deps = {
  asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  now: () => NOW,
};

function isoDate(offsetDays: number): string {
  return new Date(NOW.getTime() - offsetDays * dayMs)
    .toISOString()
    .slice(0, 10);
}

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
      { id: userA, email: 'a@c29.test', name: 'A' },
      { id: userB, email: 'b@c29.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c29-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c29-org-b', planId },
    ]);
    await tx.insert(adsAccounts).values([
      {
        id: smallAcc,
        organizationId: orgA,
        platform: 'google',
        externalAccountId: 'small-1',
        accountName: 'Small',
        currency: 'USD',
        status: 'connected',
      },
      {
        id: bigAcc,
        organizationId: orgA,
        platform: 'meta',
        externalAccountId: 'big-1',
        accountName: 'Big',
        currency: 'USD',
        status: 'connected',
      },
      {
        id: orgBAcc,
        organizationId: orgB,
        platform: 'google',
        externalAccountId: 'b-1',
        accountName: 'OrgB',
        currency: 'USD',
        status: 'connected',
      },
    ]);

    // Small account: 100 imps/day baseline. Way under floor.
    const smallRows = [];
    for (let i = 1; i <= 7; i += 1) {
      smallRows.push({
        organizationId: orgA,
        adsAccountId: smallAcc,
        platformCampaignId: 'small-c1',
        date: isoDate(i),
        impressions: 100,
        clicks: 5,
        spendCents: 100,
        spendUsdCents: 100,
        currency: 'USD',
      });
    }
    // Today: spend $0, impressions=100, clicks=0 (CTR=0).
    smallRows.push({
      organizationId: orgA,
      adsAccountId: smallAcc,
      platformCampaignId: 'small-c1',
      date: isoDate(0),
      impressions: 100,
      clicks: 0,
      spendCents: 0,
      spendUsdCents: 0,
      currency: 'USD',
    });

    // Big account: 5000 imps/day baseline @ 2% CTR. Today drops to 0.5%.
    const bigRows = [];
    for (let i = 1; i <= 7; i += 1) {
      bigRows.push({
        organizationId: orgA,
        adsAccountId: bigAcc,
        platformCampaignId: 'big-c1',
        date: isoDate(i),
        impressions: 5_000,
        clicks: 100, // 2% CTR
        spendCents: 10_000,
        spendUsdCents: 10_000,
        currency: 'USD',
      });
    }
    bigRows.push({
      organizationId: orgA,
      adsAccountId: bigAcc,
      platformCampaignId: 'big-c1',
      date: isoDate(0),
      impressions: 5_000,
      clicks: 25, // 0.5% — 75% drop = HIGH severity
      spendCents: 10_000,
      spendUsdCents: 10_000,
      currency: 'USD',
    });

    await tx.insert(adsSpendDaily).values([...smallRows, ...bigRows]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runAdsAlertsScanTick — first tick', () => {
  it('creates a CTR-drop alert for the big account, nothing for small', async () => {
    const result = await runAdsAlertsScanTick(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const orgARows = await runAdmin(fixture.db, (tx) =>
      tx.select().from(adsAlerts).where(eq(adsAlerts.organizationId, orgA)),
    );
    type Row = { adsAccountId: string; kind: string; severity: string };
    const rows = orgARows as Row[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.adsAccountId).toBe(bigAcc);
    expect(rows[0]!.kind).toBe('ctr_drop');
    expect(rows[0]!.severity).toBe('high');
  });

  it('re-running the tick within 48h on same evidence does NOT duplicate', async () => {
    await runAdsAlertsScanTick(deps);
    const rows = await runAdmin(fixture.db, (tx) =>
      tx.select().from(adsAlerts).where(eq(adsAlerts.organizationId, orgA)),
    );
    expect((rows as Array<unknown>).length).toBe(1);
  });

  it('worsened evidence ESCALATES severity, not a new row', async () => {
    // Patch ONLY today's row to a much lower CTR (0.1%) — should
    // bump severity to critical. Leaving the baseline week alone.
    await runAdmin(fixture.db, async (tx) => {
      await tx
        .update(adsSpendDaily)
        .set({ clicks: 5 })
        .where(
          and(
            eq(adsSpendDaily.platformCampaignId, 'big-c1'),
            eq(adsSpendDaily.date, isoDate(0)),
          ),
        );
    });
    await runAdsAlertsScanTick(deps);

    type Row = { severity: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ severity: adsAlerts.severity })
        .from(adsAlerts)
        .where(eq(adsAlerts.organizationId, orgA)),
    )) as Row[];
    expect(rows.length).toBe(1);
    expect(rows[0]!.severity).toBe('critical');
  });

  it('emits ads_alert.created on first detection and ads_alert.escalated on bump', async () => {
    type Row = { action: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.entityType, 'ads_alert')),
    )) as Row[];
    const actions = rows.map((r) => r.action);
    expect(actions).toContain('ads_alert.created');
    expect(actions).toContain('ads_alert.escalated');
  });

  it('tenant isolation: Org B sees no alerts despite Org A having them', async () => {
    const rows = await runAdmin(fixture.db, (tx) =>
      tx.select().from(adsAlerts).where(eq(adsAlerts.organizationId, orgB)),
    );
    expect((rows as Array<unknown>).length).toBe(0);
  });
});
