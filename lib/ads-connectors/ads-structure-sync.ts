import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import { readAccountTokens } from '@/lib/connectors/tokens';
import {
  adsAccounts,
  adsAdSets,
  adsAds,
  adsCampaigns,
  connectedAccounts,
} from '@/lib/db/schema';
import { log } from '@/lib/log';

import { type AdStructure, type AdsConnector, type AdsConnectorPlatform } from './base';
import { resolveAdsConnector } from './dispatch';
import { META_ADS_PLATFORM } from '@/lib/connectors/meta/ads-connection';

/**
 * Ads structure poll-sync (C50). Two passes, both idempotent + org-scoped (RLS):
 *
 *   1. DISCOVERY — for every `meta_ads` connection, list the user's ad accounts
 *      via the connector and upsert them into `ads_accounts` (platform 'meta'),
 *      tagging `metadata.connectedAccountId` so the insights sync + actions know
 *      which connection's token to use.
 *   2. STRUCTURE — for every `ads_accounts` (meta) linked to a connection, pull
 *      the campaign→ad-set→ad tree and upsert into `ads_campaigns` /
 *      `ads_ad_sets` / `ads_ads`.
 *
 * Insights stay in `runAdsSyncTick` (lib/jobs/ads-sync) → `ads_spend_daily`; the
 * Inngest cron runs this first so newly-discovered accounts get insights the same
 * tick. A per-connection / per-account failure is logged and skipped — never
 * aborts the sweep. Token reads + all writes happen under `dbAsOrg` (RLS); the
 * decrypted token never leaves the function.
 */

export interface AdsStructureSyncDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  connectorFor: (platform: AdsConnectorPlatform) => Promise<AdsConnector>;
}

function defaultDeps(): AdsStructureSyncDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    connectorFor: (platform) => resolveAdsConnector(platform),
  };
}

export interface AdsStructureSyncReport {
  discovered: number;
  accounts: number;
  campaigns: number;
  adSets: number;
  ads: number;
  failed: number;
}

export async function runAdsStructureSync(
  deps: AdsStructureSyncDeps = defaultDeps(),
  opts: { orgId?: string } = {},
): Promise<AdsStructureSyncReport> {
  let discovered = 0;
  let accounts = 0;
  let campaigns = 0;
  let adSets = 0;
  let ads = 0;
  let failed = 0;

  // ---- 1. Discovery: meta_ads connections → ads_accounts -------------------
  const conns = await deps.asAdmin<
    Array<{ id: string; organizationId: string }>
  >((tx) =>
    tx
      .select({
        id: connectedAccounts.id,
        organizationId: connectedAccounts.organizationId,
      })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.platform, META_ADS_PLATFORM),
          eq(connectedAccounts.status, 'connected'),
          ...(opts.orgId ? [eq(connectedAccounts.organizationId, opts.orgId)] : []),
        ),
      ),
  );

  for (const conn of conns) {
    try {
      const token = await deps.orgTx(conn.organizationId, (tx) =>
        readAccountTokens(tx, conn.id),
      );
      if (!token?.accessToken) continue;
      const connector = await deps.connectorFor('meta');
      const found = await connector.listAdAccounts({ accessToken: token.accessToken });
      await deps.orgTx(conn.organizationId, async (tx) => {
        for (const acc of found) {
          const inserted = await upsertAdAccount(tx, conn.organizationId, conn.id, acc);
          if (inserted) discovered += 1;
        }
      });
    } catch (err) {
      failed += 1;
      log.warn(
        { connectionId: conn.id, err: (err as Error).message },
        'ads_structure_sync.discovery_failed',
      );
    }
  }

  // ---- 2. Structure: ads_accounts (meta) → campaign/ad-set/ad tables -------
  const adAccounts = await deps.asAdmin<
    Array<{
      id: string;
      organizationId: string;
      externalAccountId: string;
      currency: string;
      metadata: unknown;
    }>
  >((tx) =>
    tx
      .select({
        id: adsAccounts.id,
        organizationId: adsAccounts.organizationId,
        externalAccountId: adsAccounts.externalAccountId,
        currency: adsAccounts.currency,
        metadata: adsAccounts.metadata,
      })
      .from(adsAccounts)
      .where(
        and(
          eq(adsAccounts.platform, 'meta'),
          eq(adsAccounts.status, 'connected'),
          ...(opts.orgId ? [eq(adsAccounts.organizationId, opts.orgId)] : []),
        ),
      ),
  );

  for (const acc of adAccounts) {
    const connectedAccountId = (acc.metadata as { connectedAccountId?: string } | null)
      ?.connectedAccountId;
    if (!connectedAccountId) continue;
    accounts += 1;
    try {
      const token = await deps.orgTx(acc.organizationId, (tx) =>
        readAccountTokens(tx, connectedAccountId),
      );
      const connector = await deps.connectorFor('meta');
      const structure = await connector.syncStructure({
        adsAccountId: acc.id,
        externalAccountId: acc.externalAccountId,
        currency: acc.currency,
        ...(token?.accessToken ? { accessToken: token.accessToken } : {}),
      });
      const counts = await deps.orgTx(acc.organizationId, (tx) =>
        upsertStructure(tx, acc.organizationId, acc.id, structure),
      );
      campaigns += counts.campaigns;
      adSets += counts.adSets;
      ads += counts.ads;
    } catch (err) {
      failed += 1;
      log.warn(
        { adsAccountId: acc.id, err: (err as Error).message },
        'ads_structure_sync.structure_failed',
      );
    }
  }

  const report: AdsStructureSyncReport = { discovered, accounts, campaigns, adSets, ads, failed };
  log.info(report, 'ads_structure_sync');
  return report;
}

/** Upsert one discovered ad account. Returns true when newly inserted. */
async function upsertAdAccount(
  tx: AnyPgTx,
  orgId: string,
  connectionId: string,
  acc: { externalAccountId: string; name: string; currency: string; status: 'connected' | 'disconnected' | 'error' },
): Promise<boolean> {
  const existing = (await tx
    .select({ id: adsAccounts.id, status: adsAccounts.status })
    .from(adsAccounts)
    .where(
      and(
        eq(adsAccounts.organizationId, orgId),
        eq(adsAccounts.platform, 'meta'),
        eq(adsAccounts.externalAccountId, acc.externalAccountId),
      ),
    )
    .limit(1)) as Array<{ id: string; status: 'connected' | 'disconnected' | 'error' }>;

  if (existing[0]) {
    // Reflect a platform-side disable/error (downgrade out of 'connected'), but
    // never auto-resurrect an account the user deliberately disconnected: only
    // change status when it's currently 'connected' and the platform now reports
    // otherwise.
    const nextStatus =
      existing[0].status === 'connected' && acc.status !== 'connected'
        ? acc.status
        : existing[0].status;
    await tx
      .update(adsAccounts)
      .set({
        accountName: acc.name,
        currency: acc.currency,
        status: nextStatus,
        // Merge so a manually-set brandId/other metadata survives; right side wins.
        metadata: sql`${adsAccounts.metadata} || ${JSON.stringify({ connectedAccountId: connectionId, provider: 'meta' })}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(adsAccounts.id, existing[0].id));
    return false;
  }
  await tx.insert(adsAccounts).values({
    organizationId: orgId,
    platform: 'meta',
    externalAccountId: acc.externalAccountId,
    accountName: acc.name,
    currency: acc.currency,
    status: acc.status,
    metadata: { connectedAccountId: connectionId, provider: 'meta' },
  });
  return true;
}

/** Upsert the full structure tree for one account; returns per-level counts. */
async function upsertStructure(
  tx: AnyPgTx,
  orgId: string,
  adsAccountId: string,
  structure: AdStructure,
): Promise<{ campaigns: number; adSets: number; ads: number }> {
  const campaignIdByExternal = new Map<string, string>();
  for (const c of structure.campaigns) {
    const [row] = (await tx
      .insert(adsCampaigns)
      .values({
        organizationId: orgId,
        adsAccountId,
        externalId: c.externalId,
        name: c.name,
        status: c.status,
        objective: c.objective ?? null,
        dailyBudgetCents: c.dailyBudgetCents ?? null,
        lifetimeBudgetCents: c.lifetimeBudgetCents ?? null,
        currency: c.currency ?? null,
        raw: c.raw ?? {},
      })
      .onConflictDoUpdate({
        target: [adsCampaigns.organizationId, adsCampaigns.adsAccountId, adsCampaigns.externalId],
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          objective: sql`excluded.objective`,
          dailyBudgetCents: sql`excluded.daily_budget_cents`,
          lifetimeBudgetCents: sql`excluded.lifetime_budget_cents`,
          currency: sql`excluded.currency`,
          raw: sql`excluded.raw`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: adsCampaigns.id })) as Array<{ id: string }>;
    if (row) campaignIdByExternal.set(c.externalId, row.id);
  }

  const adSetIdByExternal = new Map<string, string>();
  for (const s of structure.adSets) {
    const campaignId = s.campaignExternalId
      ? campaignIdByExternal.get(s.campaignExternalId) ?? null
      : null;
    const [row] = (await tx
      .insert(adsAdSets)
      .values({
        organizationId: orgId,
        adsAccountId,
        campaignId,
        externalId: s.externalId,
        campaignExternalId: s.campaignExternalId ?? null,
        name: s.name,
        status: s.status,
        dailyBudgetCents: s.dailyBudgetCents ?? null,
        lifetimeBudgetCents: s.lifetimeBudgetCents ?? null,
        currency: s.currency ?? null,
        raw: s.raw ?? {},
      })
      .onConflictDoUpdate({
        target: [adsAdSets.organizationId, adsAdSets.adsAccountId, adsAdSets.externalId],
        set: {
          campaignId: sql`excluded.campaign_id`,
          campaignExternalId: sql`excluded.campaign_external_id`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          dailyBudgetCents: sql`excluded.daily_budget_cents`,
          lifetimeBudgetCents: sql`excluded.lifetime_budget_cents`,
          currency: sql`excluded.currency`,
          raw: sql`excluded.raw`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: adsAdSets.id })) as Array<{ id: string }>;
    if (row) adSetIdByExternal.set(s.externalId, row.id);
  }

  for (const a of structure.ads) {
    const adSetId = a.adSetExternalId
      ? adSetIdByExternal.get(a.adSetExternalId) ?? null
      : null;
    await tx
      .insert(adsAds)
      .values({
        organizationId: orgId,
        adsAccountId,
        adSetId,
        externalId: a.externalId,
        adSetExternalId: a.adSetExternalId ?? null,
        name: a.name,
        status: a.status,
        raw: a.raw ?? {},
      })
      .onConflictDoUpdate({
        target: [adsAds.organizationId, adsAds.adsAccountId, adsAds.externalId],
        set: {
          adSetId: sql`excluded.ad_set_id`,
          adSetExternalId: sql`excluded.ad_set_external_id`,
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          raw: sql`excluded.raw`,
          updatedAt: sql`now()`,
        },
      });
  }

  return {
    campaigns: structure.campaigns.length,
    adSets: structure.adSets.length,
    ads: structure.ads.length,
  };
}
