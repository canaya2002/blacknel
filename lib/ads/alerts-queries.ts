import 'server-only';

import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  adsAccounts,
  adsAlerts,
  brands,
  users,
  type AdsAlertKind,
  type AdsAlertSeverity,
  type AdsAlertStatus,
} from '@/lib/db/schema';
import { sortBySeverityThenAge } from '@/lib/ai/recommendations';

/**
 * Read layer for `ads_alerts` (Phase 8 / Commit 29).
 *
 * Two surfaces consume it:
 *
 *   - `/ads` banner — `listAdsAlerts(orgId, {status:['pending']})`
 *     with `sortBySeverityThenAge` applied in-process
 *     (Ajuste 3).
 *   - Phase 9 history view — accepted / dismissed rollups by
 *     `(account, kind)`. Out of Commit 29 scope.
 */

export interface AdsAlertListItem {
  readonly id: string;
  readonly adsAccountId: string;
  readonly accountName: string | null;
  readonly accountPlatform: 'google' | 'meta' | 'tiktok';
  readonly externalAccountId: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly kind: AdsAlertKind;
  readonly severity: AdsAlertSeverity;
  readonly status: AdsAlertStatus;
  readonly title: string;
  readonly body: string;
  readonly evidence: Record<string, unknown>;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedByName: string | null;
  readonly decidedReason: string | null;
  readonly createdAt: Date;
}

export interface ListAdsAlertsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly status?: ReadonlyArray<AdsAlertStatus>;
  /** Restrict to one account — drill-down page (Commit 30). */
  readonly adsAccountId?: string;
  readonly limit?: number;
}

export async function listAdsAlerts(
  opts: ListAdsAlertsOpts,
): Promise<ReadonlyArray<AdsAlertListItem>> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    listAdsAlertsWithTx(tx, opts),
  );
}

export async function listAdsAlertsWithTx(
  tx: AnyPgTx,
  opts: ListAdsAlertsOpts,
): Promise<ReadonlyArray<AdsAlertListItem>> {
  const conditions: SQL[] = [eq(adsAlerts.organizationId, opts.orgId)];
  if (opts.status?.length) {
    conditions.push(
      inArray(adsAlerts.status, opts.status as Array<AdsAlertStatus>),
    );
  }
  if (opts.adsAccountId) {
    conditions.push(eq(adsAlerts.adsAccountId, opts.adsAccountId));
  }

  type Row = {
    id: string;
    adsAccountId: string;
    accountName: string | null;
    accountPlatform: 'google' | 'meta' | 'tiktok';
    externalAccountId: string;
    brandId: string | null;
    brandName: string | null;
    kind: AdsAlertKind;
    severity: AdsAlertSeverity;
    status: AdsAlertStatus;
    title: string;
    body: string;
    evidence: unknown;
    decidedAt: Date | null;
    decidedBy: string | null;
    decidedByName: string | null;
    decidedReason: string | null;
    createdAt: Date;
  };

  const rows: Row[] = await tx
    .select({
      id: adsAlerts.id,
      adsAccountId: adsAlerts.adsAccountId,
      accountName: adsAccounts.accountName,
      accountPlatform: adsAccounts.platform,
      externalAccountId: adsAccounts.externalAccountId,
      brandId: adsAlerts.brandId,
      brandName: brands.name,
      kind: adsAlerts.kind,
      severity: adsAlerts.severity,
      status: adsAlerts.status,
      title: adsAlerts.title,
      body: adsAlerts.body,
      evidence: adsAlerts.evidence,
      decidedAt: adsAlerts.decidedAt,
      decidedBy: adsAlerts.decidedBy,
      decidedByName: users.name,
      decidedReason: adsAlerts.decidedReason,
      createdAt: adsAlerts.createdAt,
    })
    .from(adsAlerts)
    .leftJoin(adsAccounts, eq(adsAccounts.id, adsAlerts.adsAccountId))
    .leftJoin(brands, eq(brands.id, adsAlerts.brandId))
    .leftJoin(users, eq(users.id, adsAlerts.decidedBy))
    .where(and(...conditions))
    .orderBy(desc(adsAlerts.createdAt))
    .limit(opts.limit ?? 50);

  const mapped = rows.map((r): AdsAlertListItem => ({
    id: r.id,
    adsAccountId: r.adsAccountId,
    accountName: r.accountName,
    accountPlatform: r.accountPlatform,
    externalAccountId: r.externalAccountId,
    brandId: r.brandId,
    brandName: r.brandName,
    kind: r.kind,
    severity: r.severity,
    status: r.status,
    title: r.title,
    body: r.body,
    evidence:
      r.evidence && typeof r.evidence === 'object'
        ? (r.evidence as Record<string, unknown>)
        : {},
    decidedAt: r.decidedAt,
    decidedBy: r.decidedBy,
    decidedByName: r.decidedByName,
    decidedReason: r.decidedReason,
    createdAt: r.createdAt,
  }));

  // Ajuste 3 — severity DESC then createdAt DESC. Applied
  // in-process because Postgres won't honor enum declaration
  // order in mixed-severity queries.
  return sortBySeverityThenAge(mapped);
}

/**
 * Pending count — drives the /ads banner conditional render +
 * a future /dashboard widget.
 */
export async function getActiveAdsAlertCount(opts: {
  orgId: string;
  userId: string;
}): Promise<number> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, async (tx) => {
    type Row = { n: string | number };
    const rows: Row[] = await tx
      .select({ n: sql<string | number>`COUNT(${adsAlerts.id})::int` })
      .from(adsAlerts)
      .where(
        and(
          eq(adsAlerts.organizationId, opts.orgId),
          eq(adsAlerts.status, 'pending'),
        ),
      );
    const n = Number(rows[0]?.n ?? 0);
    return Number.isFinite(n) ? n : 0;
  });
}
