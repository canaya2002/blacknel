import 'server-only';

import type { PlanCode } from '@/lib/plans/plans';

import { persistConnectedAccounts, type PersistDeps, type PersistResult } from '../persist';

import { META_SCOPES } from './config';
import type { ManagedAccount } from './oauth';

/**
 * Persist the Pages / IG accounts from the OAuth flow (C46) — now a thin adapter
 * over the generic connector persistence (C47, lib/connectors/persist.ts). Maps
 * Meta's parentPageId into metadata and tags provider='meta'. Idempotency, seat
 * gating, encrypted tokens + the 60-day expiry default all live in the shared
 * helper so every provider behaves identically.
 */

export type PersistMetaDeps = PersistDeps;
export type PersistMetaResult = PersistResult;

export async function persistMetaAccounts(
  input: {
    orgId: string;
    userId: string;
    planCode: PlanCode;
    accounts: ReadonlyArray<ManagedAccount>;
  },
  deps?: PersistMetaDeps,
): Promise<PersistMetaResult> {
  const accounts = input.accounts.map((a) => ({
    platform: a.platform,
    externalId: a.externalId,
    name: a.name,
    handle: a.handle,
    accessToken: a.accessToken,
    tokenExpiresAt: a.tokenExpiresAt,
    ...(a.parentPageId ? { metadata: { parentPageId: a.parentPageId } } : {}),
  }));
  return persistConnectedAccounts(
    {
      orgId: input.orgId,
      userId: input.userId,
      planCode: input.planCode,
      provider: 'meta',
      accounts,
      scopes: META_SCOPES,
    },
    deps,
  );
}
