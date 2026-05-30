import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import type { PlanCode } from '@/lib/plans/plans';
import { checkUsage, incrementUsage } from '@/lib/usage/counters';

import { getCapabilities } from '../registry';

import { META_SCOPES } from './config';
import type { ManagedAccount } from './oauth';
import { writeAccountTokens } from '../tokens';

/**
 * Persist the Pages / IG accounts returned by the OAuth flow as
 * `connected_accounts` rows with encrypted tokens (C46). Extracted from the
 * callback route so it's testable against pglite (the route stays a thin
 * auth + redirect wrapper).
 *
 * Idempotent on (org, platform, externalAccountId): re-connecting an existing
 * account refreshes its tokens + status WITHOUT a duplicate row or an extra
 * socialAccounts seat. New accounts consume a seat and respect the plan cap —
 * accounts that don't fit are skipped (reported, not silently dropped).
 */

export interface PersistMetaDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

function defaultDeps(): PersistMetaDeps {
  return {
    asUser: (ctx, fn) => dbAs(ctx, fn),
    asAdmin: (fn) => dbAdmin(fn),
  };
}

export interface PersistMetaResult {
  readonly connected: number;
  readonly skippedForPlan: number;
  readonly accountIds: ReadonlyArray<string>;
}

export async function persistMetaAccounts(
  input: {
    orgId: string;
    userId: string;
    planCode: PlanCode;
    accounts: ReadonlyArray<ManagedAccount>;
  },
  deps: PersistMetaDeps = defaultDeps(),
): Promise<PersistMetaResult> {
  const { orgId, userId, planCode, accounts } = input;
  const accountIds: string[] = [];
  let connected = 0;
  let skippedForPlan = 0;

  for (const acc of accounts) {
    // Existing row? Re-connect = update + refresh tokens, no seat charge.
    const existing = await deps.asUser<Array<{ id: string }>>({ orgId, userId }, (tx) =>
      tx
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.organizationId, orgId),
            eq(connectedAccounts.platform, acc.platform),
            eq(connectedAccounts.externalAccountId, acc.externalId),
          ),
        )
        .limit(1),
    );

    const caps = getCapabilities(acc.platform).supported;
    const metadata: Record<string, unknown> = {
      provider: 'meta',
      ...(acc.parentPageId ? { parentPageId: acc.parentPageId } : {}),
    };

    let accountId: string;
    if (existing[0]) {
      accountId = existing[0].id;
      await deps.asUser({ orgId, userId }, (tx) =>
        tx
          .update(connectedAccounts)
          .set({
            displayName: acc.name,
            handle: acc.handle,
            status: 'connected',
            errorMessage: null,
            capabilities: caps,
            metadata,
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(connectedAccounts.id, accountId)),
      );
    } else {
      // New account → plan seat gate.
      const usage = await deps.asAdmin((tx) =>
        checkUsage(tx, orgId, planCode, 'socialAccounts', 1),
      );
      if (!usage.ok) {
        skippedForPlan += 1;
        continue;
      }
      const rows = await deps.asUser<Array<{ id: string }>>({ orgId, userId }, (tx) =>
        tx
          .insert(connectedAccounts)
          .values({
            organizationId: orgId,
            platform: acc.platform,
            externalAccountId: acc.externalId,
            displayName: acc.name,
            handle: acc.handle,
            status: 'connected',
            capabilities: caps,
            metadata,
            lastSyncAt: new Date(),
          })
          .returning({ id: connectedAccounts.id }),
      );
      accountId = rows[0]!.id;
      await deps.asAdmin((tx) => incrementUsage(tx, orgId, 'socialAccounts', 1));
      connected += 1;
    }

    // Encrypt + store tokens (always, so re-connect refreshes them). Default a
    // 60-day expiry when Meta omits one, so the refresh cron (which filters on a
    // non-null token_expires_at) always picks the account up before it lapses.
    const expiresAt =
      acc.tokenExpiresAt ?? new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    await deps.asUser({ orgId, userId }, (tx) =>
      writeAccountTokens(tx, accountId, {
        accessToken: acc.accessToken,
        expiresAt,
        scopes: META_SCOPES,
      }),
    );
    accountIds.push(accountId);
  }

  return { connected, skippedForPlan, accountIds };
}
