import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { metaMockConnector } from '../../lib/ads-connectors/meta-mock';
import { runAdsStructureSync } from '../../lib/ads-connectors/ads-structure-sync';
import { _setEncryptionKeyForTests } from '../../lib/connectors/crypto';
import { persistMetaAdsConnection } from '../../lib/connectors/meta/ads-connection';
import { type AnyPgTx, runAdmin, runAs, runAsOrg } from '../../lib/db/client';
import {
  adsAccounts,
  adsAdSets,
  adsAds,
  adsCampaigns,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C50 ads structure sync (discovery + structure). pglite + real RLS, mock
 * connector (flag off), encrypted token roundtrip. Covers: meta_ads connection →
 * ad-account discovery, structure upsert, idempotent re-run, and tenant
 * isolation (org A never sees org B's structure).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c5000c5000c0';
const orgA = '11111111-1111-4111-8111-c5000c5000a0';
const orgB = '11111111-1111-4111-8111-c5000c5000b0';
const userA = '22222222-2222-4222-8222-c5000c5000a0';
const userB = '22222222-2222-4222-8222-c5000c5000b0';

const deps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
  connectorFor: async () => metaMockConnector,
};

beforeAll(async () => {
  _setEncryptionKeyForTests('ads-structure-sync-test-key-32-bytes-min!!');
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(users).values([
      { id: userA, email: 'a@c50.test', name: 'A' },
      { id: userB, email: 'b@c50.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c50-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c50-org-b', planId },
    ]);
  });
  // Both orgs connect Meta ads (distinct user tokens → distinct mock accounts).
  await persistMetaAdsConnection(
    { orgId: orgA, userId: userA, userAccessToken: 'EAAG-orgA-aaaaaa', expiresAt: null },
    { asUser: (ctx, fn) => runAs(fixture.db, ctx, fn) },
  );
  await persistMetaAdsConnection(
    { orgId: orgB, userId: userB, userAccessToken: 'EAAG-orgB-bbbbbb', expiresAt: null },
    { asUser: (ctx, fn) => runAs(fixture.db, ctx, fn) },
  );
}, 60_000);

afterAll(async () => {
  _setEncryptionKeyForTests(null);
  await fixture.dispose();
});

describe('runAdsStructureSync — discovery + structure', () => {
  it('discovers ad accounts and syncs the structure tree for both orgs', async () => {
    const report = await runAdsStructureSync(deps);
    // Each org's meta_ads connection yields 1 mock ad account.
    expect(report.discovered).toBe(2);
    expect(report.accounts).toBe(2);
    // 2 campaigns per account × 2 accounts.
    expect(report.campaigns).toBe(4);
    expect(report.adSets).toBeGreaterThanOrEqual(2);
    expect(report.ads).toBeGreaterThanOrEqual(2);
    expect(report.failed).toBe(0);

    // Discovered ad account carries the connection bridge in metadata.
    const accts = await runAdmin<Array<{ platform: string; metadata: unknown }>>(fixture.db, (tx) =>
      tx
        .select({ platform: adsAccounts.platform, metadata: adsAccounts.metadata })
        .from(adsAccounts)
        .where(eq(adsAccounts.organizationId, orgA)),
    );
    expect(accts).toHaveLength(1);
    expect(accts[0]?.platform).toBe('meta');
    expect((accts[0]?.metadata as { connectedAccountId?: string }).connectedAccountId).toBeTruthy();
    expect((accts[0]?.metadata as { provider?: string }).provider).toBe('meta');
  });

  it('ad sets link to local campaign ids; ads link to local ad-set ids', async () => {
    const campaigns = await runAsOrg<Array<{ id: string; externalId: string }>>(
      fixture.db,
      orgA,
      (tx) =>
        tx
          .select({ id: adsCampaigns.id, externalId: adsCampaigns.externalId })
          .from(adsCampaigns),
    );
    const campaignIds = new Set(campaigns.map((c) => c.id));
    const adSets = await runAsOrg<Array<{ id: string; campaignId: string | null }>>(
      fixture.db,
      orgA,
      (tx) => tx.select({ id: adsAdSets.id, campaignId: adsAdSets.campaignId }).from(adsAdSets),
    );
    expect(adSets.length).toBeGreaterThan(0);
    for (const s of adSets) expect(campaignIds.has(s.campaignId ?? '')).toBe(true);

    const adSetIds = new Set(adSets.map((s) => s.id));
    const ads = await runAsOrg<Array<{ adSetId: string | null }>>(fixture.db, orgA, (tx) =>
      tx.select({ adSetId: adsAds.adSetId }).from(adsAds),
    );
    for (const a of ads) expect(adSetIds.has(a.adSetId ?? '')).toBe(true);
  });

  it('re-running is idempotent — no new accounts or duplicate structure rows', async () => {
    const before = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    const report = await runAdsStructureSync(deps);
    expect(report.discovered).toBe(0); // accounts already exist
    const after = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    expect(after.length).toBe(before.length);
  });

  it('tenant isolation: org A sees only its own campaigns under RLS', async () => {
    const aRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgA, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    const bRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgB, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    expect(aRows.length).toBe(2);
    expect(bRows.length).toBe(2);
    // Cross-check: the row sets are disjoint.
    const aIds = new Set(aRows.map((r) => r.id));
    for (const b of bRows) expect(aIds.has(b.id)).toBe(false);
  });

  it('org-scoped opts.orgId limits the sweep to one org', async () => {
    // A fresh org with no connection → nothing to do, no cross-org leakage.
    const report = await runAdsStructureSync(deps, { orgId: orgA });
    expect(report.accounts).toBe(1); // only org A's account
  });
});
