import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { googleMockConnector } from '../../lib/ads-connectors/google-mock';
import { metaMockConnector } from '../../lib/ads-connectors/meta-mock';
import { tiktokMockConnector } from '../../lib/ads-connectors/tiktok-mock';
import { applyAdsEntityAction } from '../../lib/ads/entity-actions';
import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import {
  adsAccounts,
  adsAdSets,
  adsCampaigns,
  organizations,
  plans,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C50 ads entity actions (pause/resume/budget). pglite + RLS, mock connector
 * (flag off → no token needed). Verifies the platform dispatch + the local
 * status/budget reflection, plus validation + not-found guards.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c50ac50ac0a0';
const orgA = '11111111-1111-4111-8111-c50ac50ac0a0';
const orgB = '11111111-1111-4111-8111-c50ac50ac0b0';
const adsAccountA = '33333333-3333-4333-8333-c50ac50ac0a0';
const campaignExt = 'm-acct-1-c0';
const adSetExt = 'm-acct-1-c0-s0';
const tiktokAccount = '33333333-3333-4333-8333-c50ac50ac0c0';
const tiktokCampaignExt = 't-acct-9-c0';

const deps = {
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
  connectorFor: async (platform: 'google' | 'meta' | 'tiktok') =>
    platform === 'google'
      ? googleMockConnector
      : platform === 'tiktok'
        ? tiktokMockConnector
        : metaMockConnector,
};

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c50a-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c50a-org-b', planId },
    ]);
    await tx.insert(adsAccounts).values({
      id: adsAccountA,
      organizationId: orgA,
      platform: 'meta',
      externalAccountId: 'acct-1',
      accountName: 'Org A Meta',
      currency: 'USD',
      status: 'connected',
    });
    await tx.insert(adsCampaigns).values({
      organizationId: orgA,
      adsAccountId: adsAccountA,
      externalId: campaignExt,
      name: 'C0',
      status: 'active',
      dailyBudgetCents: 5000,
      currency: 'USD',
    });
    await tx.insert(adsAdSets).values({
      organizationId: orgA,
      adsAccountId: adsAccountA,
      externalId: adSetExt,
      campaignExternalId: campaignExt,
      name: 'S0',
      status: 'active',
    });
    // TikTok account + campaign — same platform-agnostic action path.
    await tx.insert(adsAccounts).values({
      id: tiktokAccount,
      organizationId: orgA,
      platform: 'tiktok',
      externalAccountId: 'acct-9',
      accountName: 'Org A TikTok',
      currency: 'USD',
      status: 'connected',
    });
    await tx.insert(adsCampaigns).values({
      organizationId: orgA,
      adsAccountId: tiktokAccount,
      externalId: tiktokCampaignExt,
      name: 'TT C0',
      status: 'active',
      dailyBudgetCents: 4000,
      currency: 'USD',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

async function campaignStatus(): Promise<{ status: string; dailyBudgetCents: number | null }> {
  const rows = await runAdmin<Array<{ status: string; dailyBudgetCents: number | null }>>(
    fixture.db,
    (tx) =>
      tx
        .select({ status: adsCampaigns.status, dailyBudgetCents: adsCampaigns.dailyBudgetCents })
        .from(adsCampaigns)
        .where(eq(adsCampaigns.externalId, campaignExt)),
  );
  return rows[0]!;
}

describe('applyAdsEntityAction', () => {
  it('pause flips the local campaign status to paused', async () => {
    const r = await applyAdsEntityAction(
      { orgId: orgA, adsAccountId: adsAccountA, level: 'campaign', externalId: campaignExt, action: 'pause' },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe('paused');
    expect((await campaignStatus()).status).toBe('paused');
  });

  it('resume flips it back to active', async () => {
    const r = await applyAdsEntityAction(
      { orgId: orgA, adsAccountId: adsAccountA, level: 'campaign', externalId: campaignExt, action: 'resume' },
      deps,
    );
    expect(r.ok).toBe(true);
    expect((await campaignStatus()).status).toBe('active');
  });

  it('set_budget updates the local daily budget', async () => {
    const r = await applyAdsEntityAction(
      {
        orgId: orgA,
        adsAccountId: adsAccountA,
        level: 'campaign',
        externalId: campaignExt,
        action: 'set_budget',
        dailyBudgetCents: 9900,
      },
      deps,
    );
    expect(r.ok).toBe(true);
    expect((await campaignStatus()).dailyBudgetCents).toBe(9900);
  });

  it('set_budget on an ad is a validation error (ads have no budget)', async () => {
    const r = await applyAdsEntityAction(
      { orgId: orgA, adsAccountId: adsAccountA, level: 'ad', externalId: 'x', action: 'set_budget', dailyBudgetCents: 100 },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_ERROR');
  });

  it('set_budget without an amount is a validation error', async () => {
    const r = await applyAdsEntityAction(
      { orgId: orgA, adsAccountId: adsAccountA, level: 'campaign', externalId: campaignExt, action: 'set_budget' },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION_ERROR');
  });

  it('unknown entity → NOT_FOUND', async () => {
    const r = await applyAdsEntityAction(
      { orgId: orgA, adsAccountId: adsAccountA, level: 'campaign', externalId: 'does-not-exist', action: 'pause' },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('account from another org → NOT_FOUND under RLS', async () => {
    const r = await applyAdsEntityAction(
      { orgId: orgB, adsAccountId: adsAccountA, level: 'campaign', externalId: campaignExt, action: 'pause' },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_FOUND');
  });

  it('pauses a TikTok campaign through the same platform-agnostic path', async () => {
    const r = await applyAdsEntityAction(
      { orgId: orgA, adsAccountId: tiktokAccount, level: 'campaign', externalId: tiktokCampaignExt, action: 'pause' },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe('paused');
    const rows = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: adsCampaigns.status }).from(adsCampaigns).where(eq(adsCampaigns.externalId, tiktokCampaignExt)),
    );
    expect(rows[0]?.status).toBe('paused');
  });
});
