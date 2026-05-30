import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdsStructureSync } from '../../lib/ads-connectors/ads-structure-sync';
import { googleMockConnector } from '../../lib/ads-connectors/google-mock';
import { metaMockConnector } from '../../lib/ads-connectors/meta-mock';
import { tiktokMockConnector } from '../../lib/ads-connectors/tiktok-mock';
import {
  persistAdsConnection,
  readAdsConnection,
  GOOGLE_ADS_PLATFORM,
  TIKTOK_ADS_PLATFORM,
} from '../../lib/connectors/ads-connection-store';
import { persistMetaAdsConnection } from '../../lib/connectors/meta/ads-connection';
import { _setEncryptionKeyForTests } from '../../lib/connectors/crypto';
import { type AnyPgTx, runAdmin, runAs, runAsOrg } from '../../lib/db/client';
import {
  adsAccounts,
  adsCampaigns,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C51 multi-platform ads structure sync. One org connects all three ad
 * platforms (meta_ads / google_ads / tiktok_ads); discovery upserts one
 * ads_accounts row per platform and structure syncs each. pglite + RLS, mock
 * connectors, encrypted token roundtrip, tenant isolation.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c5100c5100c0';
const orgA = '11111111-1111-4111-8111-c5100c5100a0';
const orgB = '11111111-1111-4111-8111-c5100c5100b0';
const userA = '22222222-2222-4222-8222-c5100c5100a0';
const userB = '22222222-2222-4222-8222-c5100c5100b0';

const connectorFor = async (platform: 'google' | 'meta' | 'tiktok') =>
  platform === 'google'
    ? googleMockConnector
    : platform === 'tiktok'
      ? tiktokMockConnector
      : metaMockConnector;

const deps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
  connectorFor,
};

const asUser = {
  asUser: <T>(ctx: { orgId: string; userId: string }, fn: (tx: AnyPgTx) => Promise<T>) =>
    runAs(fixture.db, ctx, fn),
};

beforeAll(async () => {
  _setEncryptionKeyForTests('ads-multiplatform-test-key-32-bytes-min!!');
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(users).values([
      { id: userA, email: 'a@c51.test', name: 'A' },
      { id: userB, email: 'b@c51.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c51-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c51-org-b', planId },
    ]);
  });
  // Org A connects all three ad platforms; Org B connects only TikTok.
  await persistMetaAdsConnection(
    { orgId: orgA, userId: userA, userAccessToken: 'EAAG-orgA-meta-aaaaaa', expiresAt: null },
    asUser,
  );
  await persistAdsConnection(
    GOOGLE_ADS_PLATFORM,
    { orgId: orgA, userId: userA, accessToken: 'goog-orgA-gggggg', refreshToken: 'r-goog', expiresAt: null },
    asUser,
  );
  await persistAdsConnection(
    TIKTOK_ADS_PLATFORM,
    { orgId: orgA, userId: userA, accessToken: 'tt-orgA-tttttt', expiresAt: null },
    asUser,
  );
  await persistAdsConnection(
    TIKTOK_ADS_PLATFORM,
    { orgId: orgB, userId: userB, accessToken: 'tt-orgB-bbbbbb', expiresAt: null },
    asUser,
  );
}, 60_000);

afterAll(async () => {
  _setEncryptionKeyForTests(null);
  await fixture.dispose();
});

describe('runAdsStructureSync — all platforms', () => {
  it('discovers one ad account per connection and syncs each structure tree', async () => {
    const report = await runAdsStructureSync(deps);
    // orgA: 3 connections, orgB: 1 → 4 ad accounts discovered.
    expect(report.discovered).toBe(4);
    expect(report.accounts).toBe(4);
    // Campaigns: meta 2 + google 3 + tiktok 2 (orgA) + tiktok 2 (orgB) = 9.
    expect(report.campaigns).toBe(9);
    expect(report.failed).toBe(0);

    const platforms = await runAdmin<Array<{ platform: string }>>(fixture.db, (tx) =>
      tx
        .select({ platform: adsAccounts.platform })
        .from(adsAccounts)
        .where(eq(adsAccounts.organizationId, orgA)),
    );
    expect(new Set(platforms.map((p) => p.platform))).toEqual(new Set(['meta', 'google', 'tiktok']));
  });

  it('readAdsConnection returns the decrypted token under org RLS', async () => {
    const orgTx = <T>(oid: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, oid, fn);
    const conn = await readAdsConnection(GOOGLE_ADS_PLATFORM, orgA, orgTx);
    expect(conn?.accessToken).toBe('goog-orgA-gggggg');
    // Cross-org: orgB has no google_ads connection.
    expect(await readAdsConnection(GOOGLE_ADS_PLATFORM, orgB, orgTx)).toBeNull();
  });

  it('re-running is idempotent (no new accounts / duplicate campaigns)', async () => {
    const before = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    const report = await runAdsStructureSync(deps);
    expect(report.discovered).toBe(0);
    const after = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    expect(after.length).toBe(before.length);
  });

  it('tenant isolation: org A never sees org B campaigns under RLS', async () => {
    const aRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgA, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    const bRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgB, (tx) =>
      tx.select({ id: adsCampaigns.id }).from(adsCampaigns),
    );
    expect(aRows.length).toBe(7); // meta 2 + google 3 + tiktok 2
    expect(bRows.length).toBe(2); // tiktok 2
    const aIds = new Set(aRows.map((r) => r.id));
    for (const b of bRows) expect(aIds.has(b.id)).toBe(false);
  });
});
