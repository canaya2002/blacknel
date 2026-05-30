import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx, dbAs, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';

import { readAccountTokens, writeAccountTokens } from '../tokens';

/**
 * The Meta ads connection (C50). Unlike the content connector — which stores one
 * `connected_accounts` row PER Page/IG with the PAGE token — the Marketing API
 * needs the USER access token (with `ads_management`/`ads_read`). We persist it
 * as a single `connected_accounts` row with platform `meta_ads`,
 * `external_account_id='me'`, so it reuses the encrypted-token storage + refresh
 * machinery without consuming a social-account seat (ads ≠ a posting seat).
 *
 * The C46 OAuth callback already exchanges the code for this user token (and was
 * discarding it after listing Pages); the callback now hands it here best-effort.
 */

export const META_ADS_PLATFORM = 'meta_ads';
const META_ADS_EXTERNAL_ID = 'me';

export interface MetaAdsConnDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
}

function defaultDeps(): MetaAdsConnDeps {
  return { asUser: (ctx, fn) => dbAs(ctx, fn) };
}

/**
 * Upsert the org's Meta ads connection with the encrypted user token. Idempotent
 * on (org, 'meta_ads', 'me') — re-connecting refreshes the token in place.
 */
export async function persistMetaAdsConnection(
  input: {
    orgId: string;
    userId: string;
    userAccessToken: string;
    expiresAt: string | null;
  },
  deps: MetaAdsConnDeps = defaultDeps(),
): Promise<{ id: string }> {
  return deps.asUser({ orgId: input.orgId, userId: input.userId }, async (tx) => {
    const existing = (await tx
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.organizationId, input.orgId),
          eq(connectedAccounts.platform, META_ADS_PLATFORM),
          eq(connectedAccounts.externalAccountId, META_ADS_EXTERNAL_ID),
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
          platform: META_ADS_PLATFORM,
          externalAccountId: META_ADS_EXTERNAL_ID,
          displayName: 'Meta Ads',
          status: 'connected',
        })
        .returning({ id: connectedAccounts.id })) as Array<{ id: string }>;
      id = inserted[0]!.id;
    }

    await writeAccountTokens(tx, id, {
      accessToken: input.userAccessToken,
      expiresAt: input.expiresAt,
    });
    return { id };
  });
}

/** Read the org's Meta ads connection + decrypted user token (under org RLS). */
export async function readMetaAdsConnection(
  orgId: string,
): Promise<{ id: string; accessToken: string } | null> {
  return dbAsOrg(orgId, async (tx) => {
    const rows = (await tx
      .select({ id: connectedAccounts.id })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.organizationId, orgId),
          eq(connectedAccounts.platform, META_ADS_PLATFORM),
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
