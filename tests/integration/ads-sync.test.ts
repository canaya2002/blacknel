import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  adsAccounts,
  adsSpendDaily,
  auditEvents,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { runAdsSyncTick } from '../../lib/jobs/ads-sync';
import { toUsdCents } from '../../lib/ads/fx-rates';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Ads-sync producer integration (Phase 8 / Commit 28).
 *
 * Covers:
 *   1. Connected accounts get upserted into ads_spend_daily.
 *   2. Re-running the tick on the same window is idempotent.
 *   3. Disconnected accounts are skipped.
 *   4. EUR-denominated account has frozen USD spend = native * rate.
 *   5. Tenant isolation: orgA's spend never leaks to orgB.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2800c2800c0';
const orgA = '11111111-1111-4111-8111-c2800c2800c0';
const orgB = '11111111-1111-4111-8111-c2800c2800c1';
const userA = '22222222-2222-4222-8222-c2800c2800c0';
const userB = '22222222-2222-4222-8222-c2800c2800c1';

const accGoogleUsd = '33333333-3333-4333-8333-c2800c2800c0';
const accMetaEur = '33333333-3333-4333-8333-c2800c2800c1';
const accDisconnected = '33333333-3333-4333-8333-c2800c2800c2';
const accOrgBGoogle = '33333333-3333-4333-8333-c2800c2800c3';

const NOW = new Date('2026-05-17T12:00:00Z');

const deps = {
  asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  now: () => NOW,
};

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
      { id: userA, email: 'a@c28.test', name: 'A' },
      { id: userB, email: 'b@c28.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c28-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c28-org-b', planId },
    ]);
    await tx.insert(adsAccounts).values([
      {
        id: accGoogleUsd,
        organizationId: orgA,
        platform: 'google',
        externalAccountId: '111-222-3333',
        accountName: 'Org A USD',
        currency: 'USD',
        status: 'connected',
      },
      {
        id: accMetaEur,
        organizationId: orgA,
        platform: 'meta',
        externalAccountId: 'act_eur_1',
        accountName: 'Org A EUR',
        currency: 'EUR',
        status: 'connected',
      },
      {
        id: accDisconnected,
        organizationId: orgA,
        platform: 'google',
        externalAccountId: '999-999-9999',
        accountName: 'Org A Disconnected',
        currency: 'USD',
        status: 'disconnected',
      },
      {
        id: accOrgBGoogle,
        organizationId: orgB,
        platform: 'google',
        externalAccountId: '444-555-6666',
        accountName: 'Org B',
        currency: 'USD',
        status: 'connected',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runAdsSyncTick — upserts rows for connected accounts', () => {
  it('first tick inserts spend rows for the 2d window', async () => {
    const result = await runAdsSyncTick(deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 3 connected accounts × (varies by platform):
    //   Google × 2 accounts (Org A + Org B) × 3 campaigns × 2 dates = 12
    //   Meta × 1 account × 2 campaigns × 2 dates = 4
    // = 16 rows total
    expect(result.data.accountsScanned).toBe(3);
    expect(result.data.rowsUpserted).toBe(16);
    expect(result.data.accountsErrored).toBe(0);
  });

  it('re-running the tick on the same window is idempotent', async () => {
    const before = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => tx.select({ id: adsSpendDaily.id }).from(adsSpendDaily),
    );
    const result = await runAdsSyncTick(deps);
    expect(result.ok).toBe(true);
    const after = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => tx.select({ id: adsSpendDaily.id }).from(adsSpendDaily),
    );
    expect(after.length).toBe(before.length);
  });

  it('disconnected account stays empty in ads_spend_daily', async () => {
    const rows = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .select({ id: adsSpendDaily.id })
        .from(adsSpendDaily)
        .where(eq(adsSpendDaily.adsAccountId, accDisconnected)),
    );
    expect(rows).toHaveLength(0);
  });

  it('EUR account has spend_usd_cents = toUsdCents(spend_cents, EUR)', async () => {
    type Row = {
      spendCents: number;
      spendUsdCents: number;
      currency: string;
    };
    const rows = await runAdmin<Row[]>(fixture.db, (tx) =>
      tx
        .select({
          spendCents: adsSpendDaily.spendCents,
          spendUsdCents: adsSpendDaily.spendUsdCents,
          currency: adsSpendDaily.currency,
        })
        .from(adsSpendDaily)
        .where(eq(adsSpendDaily.adsAccountId, accMetaEur)),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.currency).toBe('EUR');
      expect(r.spendUsdCents).toBe(toUsdCents(r.spendCents, 'EUR'));
      expect(r.spendUsdCents).toBeGreaterThan(r.spendCents);
    }
  });

  it('tenant isolation: Org A sees only its own rows under RLS', async () => {
    const orgARows = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) => tx.select({ id: adsSpendDaily.id }).from(adsSpendDaily),
    );
    const orgBRows = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) => tx.select({ id: adsSpendDaily.id }).from(adsSpendDaily),
    );
    // Org A: google 3×2 + meta 2×2 = 10 ; Org B: google 3×2 = 6
    expect(orgARows.length).toBe(10);
    expect(orgBRows.length).toBe(6);
  });

  it('writes one ads.sync.completed audit per connected account', async () => {
    type Row = { id: string; entityId: string | null };
    const rows = await runAdmin<Row[]>(fixture.db, (tx) =>
      tx
        .select({ id: auditEvents.id, entityId: auditEvents.entityId })
        .from(auditEvents)
        .where(eq(auditEvents.action, 'ads.sync.completed')),
    );
    // 2 ticks × 3 connected accounts = 6 audits.
    expect(rows.length).toBe(6);
    expect(new Set(rows.map((r) => r.entityId)).size).toBe(3);
  });

  it('touches last_sync_at on every connected account', async () => {
    type Row = {
      id: string;
      lastSyncAt: Date | null;
      status: 'connected' | 'disconnected' | 'error';
    };
    const rows = await runAdmin<Row[]>(fixture.db, (tx) =>
      tx
        .select({
          id: adsAccounts.id,
          lastSyncAt: adsAccounts.lastSyncAt,
          status: adsAccounts.status,
        })
        .from(adsAccounts),
    );
    for (const r of rows) {
      if (r.status === 'connected') {
        expect(r.lastSyncAt).not.toBeNull();
      } else {
        expect(r.lastSyncAt).toBeNull();
      }
    }
  });
});
