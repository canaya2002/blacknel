import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx, dbAs, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';

import { readAccountTokens, writeAccountTokens } from './tokens';

/**
 * Generic ad-platform connection store (C51), generalizing C50's
 * `meta/ads-connection.ts` for Google Ads + TikTok Ads. Each ad platform's
 * Marketing API needs the USER/advertiser token (not a per-account social
 * token), so we persist ONE `connected_accounts` row per (org, platform) with
 * `external_account_id='me'` holding the encrypted token — reusing the
 * encrypted-token storage + refresh machinery WITHOUT consuming a social seat
 * (an ads connection isn't a posting seat). Ad accounts themselves live in
 * `ads_accounts`, discovered by the structure sync from this connection.
 */

export const GOOGLE_ADS_PLATFORM = 'google_ads';
export const TIKTOK_ADS_PLATFORM = 'tiktok_ads';
const CONNECTION_EXTERNAL_ID = 'me';

export interface AdsConnStoreDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
}

function defaultDeps(): AdsConnStoreDeps {
  return { asUser: (ctx, fn) => dbAs(ctx, fn) };
}

/** Upsert an org's ad-platform connection with the encrypted token (no seat gate). */
export async function persistAdsConnection(
  platform: string,
  input: {
    orgId: string;
    userId: string;
    accessToken: string;
    refreshToken?: string | null;
    expiresAt: string | null;
    displayName?: string;
  },
  deps: AdsConnStoreDeps = defaultDeps(),
): Promise<{ id: string }> {
  return deps.asUser({ orgId: input.orgId, userId: input.userId }, async (tx) => {
    const existing = (await tx
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.organizationId, input.orgId),
          eq(connectedAccounts.platform, platform),
          eq(connectedAccounts.externalAccountId, CONNECTION_EXTERNAL_ID),
        ),
      )
      .limit(1)) as Array<{ id: string }>;

    let id: string;
    if (existing[0]) {
      id = existing[0].id;
      await tx
        .update(connectedAccounts)
        .set({ status: 'connected', updatedAt: new Date() })
        .where(eq(connectedAccounts.id, id));
    } else {
      const inserted = (await tx
        .insert(connectedAccounts)
        .values({
          organizationId: input.orgId,
          platform,
          externalAccountId: CONNECTION_EXTERNAL_ID,
          displayName: input.displayName ?? platform,
          status: 'connected',
        })
        .returning({ id: connectedAccounts.id })) as Array<{ id: string }>;
      id = inserted[0]!.id;
    }

    await writeAccountTokens(tx, id, {
      accessToken: input.accessToken,
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      expiresAt: input.expiresAt,
    });
    return { id };
  });
}

/** Read an org's ad-platform connection + decrypted token (under org RLS). */
export async function readAdsConnection(
  platform: string,
  orgId: string,
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T> = (oid, fn) =>
    dbAsOrg(oid, fn),
): Promise<{ id: string; accessToken: string } | null> {
  return orgTx(orgId, async (tx) => {
    const rows = (await tx
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.organizationId, orgId),
          eq(connectedAccounts.platform, platform),
          eq(connectedAccounts.status, 'connected'),
        ),
      )
      .limit(1)) as Array<{ id: string }>;
    if (!rows[0]) return null;
    const tokens = await readAccountTokens(tx, rows[0].id);
    if (!tokens?.accessToken) return null;
    return { id: rows[0].id, accessToken: tokens.accessToken };
  });
}
