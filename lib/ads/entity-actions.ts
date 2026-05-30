import 'server-only';

import { and, eq } from 'drizzle-orm';

import {
  type AdsActionType,
  type AdsConnector,
  type AdsConnectorPlatform,
  type AdsEntityLevel,
} from '@/lib/ads-connectors/base';
import { isRealAdsEnabled, resolveAdsConnector } from '@/lib/ads-connectors/dispatch';
import { type AnyPgTx, dbAsOrg } from '@/lib/db/client';
import { adsAccounts, adsAdSets, adsAds, adsCampaigns } from '@/lib/db/schema';
import { readAccountTokens } from '@/lib/connectors/tokens';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Apply a pause / resume / budget change to one ads entity (C50). Reads the
 * account + verifies the target entity under the caller's org RLS, dispatches the
 * change to the platform (real Meta Marketing API when gated, else the mock
 * connector — same real-vs-mock seam as the sync), then reflects the new
 * status/budget on the local structure row. The platform call happens OUTSIDE
 * the read transaction; the token never leaves this function.
 *
 * Campaign creation is intentionally NOT here — it's a multi-surface flow
 * (objective, targeting, creative, billing) deferred to a future pass. See
 * `createAdsCampaign` below for the documented stub.
 */

export interface AdsEntityActionInput {
  orgId: string;
  adsAccountId: string;
  level: AdsEntityLevel;
  externalId: string;
  action: AdsActionType;
  /** Required for `set_budget`: new DAILY budget in native cents (> 0). */
  dailyBudgetCents?: number;
}

export interface AdsEntityActionResult {
  externalId: string;
  /** Normalized status after pause/resume (undefined for set_budget). */
  status?: string;
  dailyBudgetCents?: number;
}

export interface AdsActionDeps {
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  connectorFor: (platform: AdsConnectorPlatform) => Promise<AdsConnector>;
}

function defaultDeps(): AdsActionDeps {
  return {
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    connectorFor: (platform) => resolveAdsConnector(platform),
  };
}

function entityTable(level: AdsEntityLevel) {
  switch (level) {
    case 'campaign':
      return adsCampaigns;
    case 'ad_set':
      return adsAdSets;
    case 'ad':
      return adsAds;
  }
}

export async function applyAdsEntityAction(
  input: AdsEntityActionInput,
  deps: AdsActionDeps = defaultDeps(),
): Promise<Result<AdsEntityActionResult>> {
  const { orgId, adsAccountId, level, externalId, action } = input;

  if (action === 'set_budget') {
    if (level === 'ad') {
      return err('VALIDATION_ERROR', 'Ads have no budget — set the budget on the campaign or ad set.');
    }
    if (
      input.dailyBudgetCents == null ||
      !Number.isInteger(input.dailyBudgetCents) ||
      input.dailyBudgetCents <= 0
    ) {
      return err('VALIDATION_ERROR', 'set_budget requires a positive integer dailyBudgetCents.');
    }
  }

  const table = entityTable(level);

  // Read account + verify the entity, all under org RLS.
  const ctx = await deps.orgTx(orgId, async (tx) => {
    const accRows = (await tx
      .select({
        id: adsAccounts.id,
        platform: adsAccounts.platform,
        externalAccountId: adsAccounts.externalAccountId,
        currency: adsAccounts.currency,
        metadata: adsAccounts.metadata,
      })
      .from(adsAccounts)
      .where(and(eq(adsAccounts.id, adsAccountId), eq(adsAccounts.organizationId, orgId)))
      .limit(1)) as Array<{
      id: string;
      platform: AdsConnectorPlatform;
      externalAccountId: string;
      currency: string;
      metadata: unknown;
    }>;
    const acc = accRows[0];
    if (!acc) return { kind: 'account_not_found' as const };

    const entityRows = (await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.organizationId, orgId),
          eq(table.adsAccountId, adsAccountId),
          eq(table.externalId, externalId),
        ),
      )
      .limit(1)) as Array<{ id: string }>;
    if (!entityRows[0]) return { kind: 'entity_not_found' as const };
    return { kind: 'ok' as const, acc };
  });

  if (ctx.kind === 'account_not_found') return err('NOT_FOUND', 'Ads account not found.');
  if (ctx.kind === 'entity_not_found') return err('NOT_FOUND', 'Ads entity not found.');

  const acc = ctx.acc;
  const connectedAccountId = (acc.metadata as { connectedAccountId?: string } | null)
    ?.connectedAccountId;

  // Token only on the real path (mock ignores it).
  let accessToken: string | undefined;
  if (connectedAccountId && (await isRealAdsEnabled(acc.platform))) {
    const tokens = await deps.orgTx(orgId, (tx) => readAccountTokens(tx, connectedAccountId));
    accessToken = tokens?.accessToken;
  }

  const connector = await deps.connectorFor(acc.platform);
  const platformResult = await connector.applyAction(
    {
      adsAccountId: acc.id,
      externalAccountId: acc.externalAccountId,
      currency: acc.currency,
      ...(accessToken ? { accessToken } : {}),
    },
    {
      level,
      externalId,
      action,
      ...(input.dailyBudgetCents != null ? { dailyBudgetCents: input.dailyBudgetCents } : {}),
    },
  );

  if (!platformResult.ok) {
    return err('INTERNAL_ERROR', 'Platform rejected the ads action.');
  }

  // Reflect the change locally so the dashboard updates without waiting for the
  // next structure sync.
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (action === 'pause') set.status = 'paused';
  else if (action === 'resume') set.status = 'active';
  else set.dailyBudgetCents = input.dailyBudgetCents;

  await deps.orgTx(orgId, (tx) =>
    tx
      .update(table)
      .set(set)
      .where(
        and(
          eq(table.organizationId, orgId),
          eq(table.adsAccountId, adsAccountId),
          eq(table.externalId, externalId),
        ),
      ),
  );

  return ok({
    externalId,
    ...(platformResult.status ? { status: platformResult.status } : {}),
    ...(action === 'set_budget' ? { dailyBudgetCents: input.dailyBudgetCents } : {}),
  });
}

/**
 * Campaign creation — documented STUB (C50). Creating a campaign on Meta is a
 * multi-step flow (objective, ad set targeting + schedule + budget, creative
 * upload, billing checks) that warrants its own pass. Returns a typed
 * not-implemented error so a caller can surface it cleanly rather than 500.
 */
export async function createAdsCampaign(): Promise<Result<never>> {
  return err('NOT_IMPLEMENTED', 'Ads campaign creation is not available yet.');
}
