import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import type { PlanCode } from '@/lib/plans/plans';
import { checkUsage, incrementUsage } from '@/lib/usage/counters';

import { getCapabilities } from './registry';
import { writeAccountTokens } from './tokens';
import type { ManagedAccount } from './oauth/types';

/**
 * Generic connect-time persistence for OAuth connectors (C47, generalized from
 * the C46 Meta flow). Upserts each discovered account as a connected_accounts
 * row with ENCRYPTED tokens, idempotent on (org, platform, externalAccountId):
 * re-connect refreshes tokens + status WITHOUT a duplicate row or an extra seat;
 * new accounts consume a seat and respect the plan cap (overflow skipped, not
 * dropped silently). Tokens default to a 60-day expiry when the platform omits
 * one, so the refresh cron always picks the account up.
 *
 * All DB ops go through the deps seam so tests run against pglite; production
 * uses dbAs (RLS) for the rows + dbAdmin for the usage counter.
 */

export interface PersistDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

function defaultDeps(): PersistDeps {
  return {
    asUser: (ctx, fn) => dbAs(ctx, fn),
    asAdmin: (fn) => dbAdmin(fn),
  };
}

const DEFAULT_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export interface PersistResult {
  readonly connected: number;
  readonly skippedForPlan: number;
  readonly accountIds: ReadonlyArray<string>;
}

export async function persistConnectedAccounts(
  input: {
    orgId: string;
    userId: string;
    planCode: PlanCode;
    /** Tag stored in metadata.provider (e.g. 'meta', 'linkedin'). */
    provider: string;
    accounts: ReadonlyArray<ManagedAccount>;
    scopes?: ReadonlyArray<string>;
  },
  deps: PersistDeps = defaultDeps(),
): Promise<PersistResult> {
  const { orgId, userId, planCode, provider, accounts } = input;
  const accountIds: string[] = [];
  let connected = 0;
  let skippedForPlan = 0;

  for (const acc of accounts) {
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
    const metadata: Record<string, unknown> = { provider, ...(acc.metadata ?? {}) };

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

    const expiresAt =
      acc.tokenExpiresAt ?? new Date(Date.now() + DEFAULT_TOKEN_TTL_MS).toISOString();
    await deps.asUser({ orgId, userId }, (tx) =>
      writeAccountTokens(tx, accountId, {
        accessToken: acc.accessToken,
        ...(acc.refreshToken ? { refreshToken: acc.refreshToken } : {}),
        expiresAt,
        ...(input.scopes ? { scopes: input.scopes } : {}),
      }),
    );
    accountIds.push(accountId);
  }

  return { connected, skippedForPlan, accountIds };
}
