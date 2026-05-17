import 'server-only';

import { and, desc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';

import { type AnyPgTx, dbAs } from '../db/client';
import { aiRecommendations, brands, users } from '../db/schema';

/**
 * Read layer for `ai_recommendations` (Phase 7 / Commit 25).
 *
 * Consumers:
 *
 *   - `/reputation` banner (pending crisis recs)
 *   - `/reputation/crisis/history` (decided crisis recs in last 90d)
 *   - Phase 8+ dashboards (cross-org analytics — out of Commit 25)
 *
 * RLS: rows are scoped by `organization_id`; production reads
 * always go through `dbAs`. The `*WithTx` siblings exist for the
 * dashboard loader pattern (Phase 6 precedent).
 */

export type CrisisRecStatus = 'pending' | 'accepted' | 'dismissed';
export type CrisisSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface CrisisRecListItem {
  readonly id: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: CrisisRecStatus;
  readonly severity: CrisisSeverity;
  readonly reviewIds: ReadonlyArray<string>;
  readonly messageIds: ReadonlyArray<string>;
  readonly recommendedAction: string | null;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedByName: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: Date;
}

export interface ListCrisisOpts {
  readonly orgId: string;
  readonly userId: string;
  /** Filter to a specific status set; default: all. */
  readonly status?: ReadonlyArray<CrisisRecStatus>;
  /** Only rows with `created_at >= since`. */
  readonly since?: Date;
  readonly limit?: number;
}

export async function listCrisisRecommendations(
  opts: ListCrisisOpts,
): Promise<ReadonlyArray<CrisisRecListItem>> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, (tx) =>
    listCrisisRecommendationsWithTx(tx, opts),
  );
}

export async function listCrisisRecommendationsWithTx(
  tx: AnyPgTx,
  opts: ListCrisisOpts,
): Promise<ReadonlyArray<CrisisRecListItem>> {
  const conditions: SQL[] = [
    eq(aiRecommendations.organizationId, opts.orgId),
    eq(aiRecommendations.category, 'crisis'),
  ];
  if (opts.status?.length) {
    conditions.push(
      inArray(aiRecommendations.status, opts.status as Array<CrisisRecStatus>),
    );
  }
  if (opts.since) {
    conditions.push(gte(aiRecommendations.createdAt, opts.since));
  }

  type Row = {
    id: string;
    brandId: string | null;
    brandName: string | null;
    title: string;
    body: string;
    status: CrisisRecStatus;
    evidence: unknown;
    createdAt: Date;
    decidedAt: Date | null;
    decidedBy: string | null;
    decidedByName: string | null;
    decisionReason: string | null;
  };
  const rows = (await tx
    .select({
      id: aiRecommendations.id,
      brandId: aiRecommendations.brandId,
      brandName: brands.name,
      title: aiRecommendations.title,
      body: aiRecommendations.body,
      status: aiRecommendations.status,
      evidence: aiRecommendations.evidence,
      createdAt: aiRecommendations.createdAt,
      decidedAt: aiRecommendations.decidedAt,
      decidedBy: aiRecommendations.decidedBy,
      decidedByName: users.name,
      decisionReason: sql<string | null>`(${aiRecommendations.evidence} ->> 'decisionReason')`,
    })
    .from(aiRecommendations)
    .leftJoin(brands, eq(brands.id, aiRecommendations.brandId))
    .leftJoin(users, eq(users.id, aiRecommendations.decidedBy))
    .where(and(...conditions))
    .orderBy(desc(aiRecommendations.createdAt))
    .limit(opts.limit ?? 50)) as Row[];

  return rows.map((r): CrisisRecListItem => {
    const ev = (r.evidence ?? {}) as Record<string, unknown>;
    return {
      id: r.id,
      brandId: r.brandId,
      brandName: r.brandName,
      title: r.title,
      body: r.body,
      status: r.status,
      severity:
        typeof ev.severity === 'string'
          ? (ev.severity as CrisisSeverity)
          : 'medium',
      reviewIds: Array.isArray(ev.reviewIds)
        ? (ev.reviewIds as unknown[]).filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
      messageIds: Array.isArray(ev.messageIds)
        ? (ev.messageIds as unknown[]).filter(
            (v): v is string => typeof v === 'string',
          )
        : [],
      recommendedAction:
        typeof ev.recommendedAction === 'string'
          ? (ev.recommendedAction as string)
          : null,
      decidedAt: r.decidedAt,
      decidedBy: r.decidedBy,
      decidedByName: r.decidedByName,
      decisionReason: r.decisionReason,
      createdAt: r.createdAt,
    };
  });
}

/**
 * Counts pending crisis recs — drives the `/reputation` banner
 * conditional render + Phase 12 `/dashboard` widget.
 */
export async function getActiveCrisisCount(opts: {
  orgId: string;
  userId: string;
}): Promise<number> {
  return dbAs({ orgId: opts.orgId, userId: opts.userId }, async (tx) => {
    type Row = { n: string | number };
    const rows = (await tx
      .select({ n: sql<string | number>`COUNT(${aiRecommendations.id})::int` })
      .from(aiRecommendations)
      .where(
        and(
          eq(aiRecommendations.organizationId, opts.orgId),
          eq(aiRecommendations.category, 'crisis'),
          eq(aiRecommendations.status, 'pending'),
        ),
      )) as Row[];
    const n = Number(rows[0]?.n ?? 0);
    return Number.isFinite(n) ? n : 0;
  });
}
