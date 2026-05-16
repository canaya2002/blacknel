import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';

import { type AnyPgTx, dbAs } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import {
  type Capability,
  type PlatformCode,
  PLATFORMS,
} from '@/lib/connectors/base';
import { getCapabilities } from '@/lib/connectors/registry';

/**
 * Read paths the composer needs that the C18 page-level loader
 * doesn't already cover.
 *
 * # Publish-capable accounts
 *
 * The account picker lists every `connected_account` that:
 *
 *   1. Belongs to the caller's org (RLS + redundant org_id
 *      predicate),
 *   2. Has status='connected' (expired / error accounts are not
 *      pickable until the user reconnects from /integrations),
 *   3. Optionally matches the post's brand,
 *   4. Whose connector declares at least one of `publish_post`,
 *      `schedule_post` capabilities.
 *
 * Capability filtering happens in JS rather than SQL because the
 * source of truth is the connector registry (capabilities are
 * frozen per-platform code, not stored per-row beyond a snapshot
 * mirror — see `connected_accounts.capabilities` JSDoc).
 */

export interface PublishCapableAccount {
  readonly id: string;
  readonly platform: PlatformCode;
  readonly brandId: string | null;
  readonly displayName: string | null;
  readonly handle: string | null;
  readonly capabilities: ReadonlyArray<Capability>;
}

export interface ListPublishCapableAccountsOpts {
  readonly orgId: string;
  readonly userId: string;
  /** When set, scope to a single brand (matches posts.brand_id). */
  readonly brandId?: string | null;
}

const PUBLISH_RELEVANT: ReadonlyArray<Capability> = ['publish_post', 'schedule_post'];
const PLATFORM_SET: ReadonlySet<string> = new Set(PLATFORMS);

export async function listPublishCapableAccounts(
  opts: ListPublishCapableAccountsOpts,
): Promise<ReadonlyArray<PublishCapableAccount>> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, async (tx) =>
    listPublishCapableAccountsWithTx(tx, opts),
  );
}

export async function listPublishCapableAccountsWithTx(
  tx: AnyPgTx,
  opts: ListPublishCapableAccountsOpts,
): Promise<ReadonlyArray<PublishCapableAccount>> {
  const conditions = [
    eq(connectedAccounts.organizationId, opts.orgId),
    eq(connectedAccounts.status, 'connected'),
  ];
  if (opts.brandId !== undefined && opts.brandId !== null) {
    conditions.push(eq(connectedAccounts.brandId, opts.brandId));
  }

  type Row = {
    id: string;
    platform: string;
    brandId: string | null;
    displayName: string | null;
    handle: string | null;
    capabilities: unknown;
  };

  const rows = (await tx
    .select({
      id: connectedAccounts.id,
      platform: connectedAccounts.platform,
      brandId: connectedAccounts.brandId,
      displayName: connectedAccounts.displayName,
      handle: connectedAccounts.handle,
      capabilities: connectedAccounts.capabilities,
    })
    .from(connectedAccounts)
    .where(and(...conditions))
    .orderBy(asc(connectedAccounts.platform), asc(connectedAccounts.displayName))) as Row[];

  return rows
    .filter((r): r is Row & { platform: PlatformCode } => PLATFORM_SET.has(r.platform))
    .filter((r) => {
      // Source of truth for what a connector can actually do today
      // lives in the registry — `capabilities` on the row is just
      // a snapshot from connect-time. Use the registry to decide
      // picker visibility.
      const supported = getCapabilities(r.platform).supported;
      return PUBLISH_RELEVANT.some((cap) => supported.includes(cap));
    })
    .map((r): PublishCapableAccount => ({
      id: r.id,
      platform: r.platform,
      brandId: r.brandId,
      displayName: r.displayName,
      handle: r.handle,
      capabilities: Array.isArray(r.capabilities)
        ? (r.capabilities as ReadonlyArray<Capability>)
        : [],
    }));
}

/**
 * Variant for callers that already know which account ids they
 * want hydrated (e.g. resolving the picker selection back into
 * account metadata for the preview column). Returns rows in the
 * same order as `accountIds`; missing ids drop out.
 */
export async function hydrateAccounts(opts: {
  orgId: string;
  userId: string;
  accountIds: ReadonlyArray<string>;
}): Promise<ReadonlyArray<PublishCapableAccount>> {
  if (opts.accountIds.length === 0) return [];
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, async (tx) => {
    type Row = {
      id: string;
      platform: string;
      brandId: string | null;
      displayName: string | null;
      handle: string | null;
      capabilities: unknown;
    };
    const rows = (await tx
      .select({
        id: connectedAccounts.id,
        platform: connectedAccounts.platform,
        brandId: connectedAccounts.brandId,
        displayName: connectedAccounts.displayName,
        handle: connectedAccounts.handle,
        capabilities: connectedAccounts.capabilities,
      })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.organizationId, opts.orgId),
          inArray(connectedAccounts.id, [...opts.accountIds]),
        ),
      )) as Row[];

    const byId = new Map<string, Row>();
    for (const r of rows) byId.set(r.id, r);
    return opts.accountIds
      .map((id) => byId.get(id))
      .filter((r): r is Row => r !== undefined)
      .filter((r): r is Row & { platform: PlatformCode } =>
        PLATFORM_SET.has(r.platform),
      )
      .map((r): PublishCapableAccount => ({
        id: r.id,
        platform: r.platform,
        brandId: r.brandId,
        displayName: r.displayName,
        handle: r.handle,
        capabilities: Array.isArray(r.capabilities)
          ? (r.capabilities as ReadonlyArray<Capability>)
          : [],
      }));
  });
}
