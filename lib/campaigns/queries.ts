import 'server-only';

import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { type AnyPgTx, dbAs } from '../db/client';
import {
  brands,
  campaigns,
  posts,
  users,
} from '../db/schema';

import { encodeCampaignCursor, type CampaignCursor } from './cursor';
import type { CampaignFilters } from './filters';
import type { CampaignGoal, CampaignStatus } from './validate';

/**
 * Read paths for /publish/campaigns (Commit 21).
 *
 * Same pattern as inbox / reviews / approvals / publish:
 *   - `dbAs` so RLS evaluates exactly as production.
 *   - Redundant `organization_id` predicate for planner hints.
 *   - Cursor-based pagination keyed on `(created_at, id) DESC`.
 *   - `*WithTx` sibling functions so the page loader can roll
 *     multiple reads into a single transaction.
 *
 * # Surface
 *
 *   - `listCampaigns`           — list view + filters + cursor.
 *   - `getCampaignDetail`       — single row + brand/owner names +
 *                                 post counts.
 *   - `getCampaignKpiCounts`    — header KPIs.
 *   - `getPostsByCampaignWithTx`— posts attached to a campaign,
 *                                 reuses the C18 `PostListItem`
 *                                 shape so the Posts tab can drop
 *                                 in `<PostListRow />` unchanged.
 */

const DEFAULT_PAGE_SIZE = 50;

export interface CampaignListItem {
  readonly id: string;
  readonly name: string;
  readonly goal: CampaignGoal;
  readonly status: CampaignStatus;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly budgetCents: number | null;
  readonly ownerId: string | null;
  readonly ownerName: string | null;
  readonly createdAt: Date;
  /** Number of posts assigned to this campaign. */
  readonly postCount: number;
  /** Number of posts in `'published'` status. */
  readonly publishedPostCount: number;
}

export interface CampaignListPage {
  readonly campaigns: ReadonlyArray<CampaignListItem>;
  readonly nextCursor: string | null;
}

export interface ListCampaignsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: CampaignFilters;
  readonly cursor: CampaignCursor | null;
  readonly pageSize?: number;
}

export async function listCampaigns(
  opts: ListCampaignsOpts,
): Promise<CampaignListPage> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) => listCampaignsWithTx(tx, opts),
  );
}

export async function listCampaignsWithTx(
  tx: AnyPgTx,
  opts: ListCampaignsOpts,
): Promise<CampaignListPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const conditions: SQL[] = [eq(campaigns.organizationId, opts.orgId)];

  if (opts.filters.status?.length) {
    conditions.push(
      inArray(campaigns.status, opts.filters.status as Array<CampaignStatus>),
    );
  }
  if (opts.filters.goal) {
    conditions.push(eq(campaigns.goal, opts.filters.goal));
  }
  if (opts.filters.brandId) {
    conditions.push(eq(campaigns.brandId, opts.filters.brandId));
  }
  if (opts.filters.q) {
    conditions.push(
      sql`${campaigns.name} ILIKE ${'%' + opts.filters.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'}`,
    );
  }
  if (opts.filters.startsFrom) {
    conditions.push(
      sql`${campaigns.startsAt} >= ${opts.filters.startsFrom}::timestamptz`,
    );
  }
  if (opts.filters.startsTo) {
    conditions.push(
      sql`${campaigns.startsAt} < (${opts.filters.startsTo}::date + interval '1 day')`,
    );
  }
  // Cursor predicate — tuple comparison on (created_at, id) DESC.
  if (opts.cursor) {
    conditions.push(
      sql`(${campaigns.createdAt}, ${campaigns.id}) < (${opts.cursor.t}::timestamptz, ${opts.cursor.i}::uuid)`,
    );
  }

  type Row = {
    id: string;
    name: string;
    goal: CampaignGoal;
    status: CampaignStatus;
    brandId: string | null;
    brandName: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    budgetCents: number | null;
    ownerId: string | null;
    ownerName: string | null;
    createdAt: Date;
    postCount: string | number;
    publishedPostCount: string | number;
  };

  const rows: Row[] = await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      goal: campaigns.goal,
      status: campaigns.status,
      brandId: campaigns.brandId,
      brandName: brands.name,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
      budgetCents: campaigns.budgetCents,
      ownerId: campaigns.ownerId,
      ownerName: users.name,
      createdAt: campaigns.createdAt,
      postCount: sql<string | number>`(
        SELECT COUNT(*)::int FROM posts p WHERE p.campaign_id = ${campaigns.id}
      )`.as('post_count'),
      publishedPostCount: sql<string | number>`(
        SELECT COUNT(*)::int FROM posts p
        WHERE p.campaign_id = ${campaigns.id} AND p.status = 'published'
      )`.as('published_post_count'),
    })
    .from(campaigns)
    .leftJoin(brands, eq(brands.id, campaigns.brandId))
    .leftJoin(users, eq(users.id, campaigns.ownerId))
    .where(and(...conditions))
    .orderBy(desc(campaigns.createdAt), desc(campaigns.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const visible = hasMore ? rows.slice(0, pageSize) : rows;
  const last = visible[visible.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCampaignCursor({ t: last.createdAt.toISOString(), i: last.id })
      : null;

  return {
    campaigns: visible.map((r): CampaignListItem => ({
      id: r.id,
      name: r.name,
      goal: r.goal,
      status: r.status,
      brandId: r.brandId,
      brandName: r.brandName,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      budgetCents: r.budgetCents,
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      createdAt: r.createdAt,
      postCount: toNum(r.postCount) ?? 0,
      publishedPostCount: toNum(r.publishedPostCount) ?? 0,
    })),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface CampaignDetail extends CampaignListItem {
  readonly metadata: Record<string, unknown>;
  /**
   * Phase-6 placeholder for "spent" tracking. Real value is computed
   * in Phase 8 from ad accounts; today we store user-entered manual
   * cents under `metadata.manualSpentCents`. NULL when unset.
   */
  readonly manualSpentCents: number | null;
  /** Number of posts in `'failed'` status. */
  readonly failedPostCount: number;
  /** Number of posts in `'scheduled'` status. */
  readonly scheduledPostCount: number;
}

export async function getCampaignDetail(opts: {
  orgId: string;
  userId: string;
  campaignId: string;
}): Promise<CampaignDetail | null> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) => getCampaignDetailWithTx(tx, { orgId: opts.orgId, campaignId: opts.campaignId }),
  );
}

export async function getCampaignDetailWithTx(
  tx: AnyPgTx,
  opts: { orgId: string; campaignId: string },
): Promise<CampaignDetail | null> {
  type DetailRow = {
    id: string;
    name: string;
    goal: CampaignGoal;
    status: CampaignStatus;
    brandId: string | null;
    brandName: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    budgetCents: number | null;
    ownerId: string | null;
    ownerName: string | null;
    createdAt: Date;
    metadata: unknown;
    postCount: string | number;
    publishedPostCount: string | number;
    failedPostCount: string | number;
    scheduledPostCount: string | number;
  };
  const rows = (await tx
    .select({
        id: campaigns.id,
        name: campaigns.name,
        goal: campaigns.goal,
        status: campaigns.status,
        brandId: campaigns.brandId,
        brandName: brands.name,
        startsAt: campaigns.startsAt,
        endsAt: campaigns.endsAt,
        budgetCents: campaigns.budgetCents,
        ownerId: campaigns.ownerId,
        ownerName: users.name,
        createdAt: campaigns.createdAt,
        metadata: campaigns.metadata,
        postCount: sql<string | number>`(
          SELECT COUNT(*)::int FROM posts p WHERE p.campaign_id = ${campaigns.id}
        )`.as('post_count'),
        publishedPostCount: sql<string | number>`(
          SELECT COUNT(*)::int FROM posts p
          WHERE p.campaign_id = ${campaigns.id} AND p.status = 'published'
        )`.as('published_post_count'),
        failedPostCount: sql<string | number>`(
          SELECT COUNT(*)::int FROM posts p
          WHERE p.campaign_id = ${campaigns.id} AND p.status = 'failed'
        )`.as('failed_post_count'),
        scheduledPostCount: sql<string | number>`(
          SELECT COUNT(*)::int FROM posts p
          WHERE p.campaign_id = ${campaigns.id} AND p.status = 'scheduled'
        )`.as('scheduled_post_count'),
      })
      .from(campaigns)
      .leftJoin(brands, eq(brands.id, campaigns.brandId))
      .leftJoin(users, eq(users.id, campaigns.ownerId))
      .where(
        and(
          eq(campaigns.id, opts.campaignId),
          eq(campaigns.organizationId, opts.orgId),
        ),
      )
      .limit(1)) as DetailRow[];

  const row = rows[0];
  if (!row) return null;

  const metadata =
    row.metadata && typeof row.metadata === 'object'
      ? (row.metadata as Record<string, unknown>)
      : {};
  const manualSpentCents =
    typeof metadata.manualSpentCents === 'number'
      ? (metadata.manualSpentCents as number)
      : null;

  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    status: row.status,
    brandId: row.brandId,
    brandName: row.brandName,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    budgetCents: row.budgetCents,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    createdAt: row.createdAt,
    postCount: toNum(row.postCount) ?? 0,
    publishedPostCount: toNum(row.publishedPostCount) ?? 0,
    failedPostCount: toNum(row.failedPostCount) ?? 0,
    scheduledPostCount: toNum(row.scheduledPostCount) ?? 0,
    metadata,
    manualSpentCents,
  };
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export interface CampaignKpiCounts {
  readonly active: number;
  readonly draft: number;
  readonly paused: number;
  readonly completed: number;
  readonly archived: number;
  /** Sum of `budget_cents` across non-archived campaigns. */
  readonly totalBudgetCents: number;
}

export async function getCampaignKpiCounts(opts: {
  orgId: string;
  userId: string;
}): Promise<CampaignKpiCounts> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) => getCampaignKpiCountsWithTx(tx, opts.orgId),
  );
}

export async function getCampaignKpiCountsWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<CampaignKpiCounts> {
  type StatusRow = { status: CampaignStatus; n: string | number };
  const statusRows = (await tx
    .select({ status: campaigns.status, n: count(campaigns.id) })
    .from(campaigns)
    .where(eq(campaigns.organizationId, orgId))
    .groupBy(campaigns.status)) as StatusRow[];
  const byStatus = Object.fromEntries(
    statusRows.map((r) => [r.status, toNum(r.n) ?? 0]),
  );

  type BudgetRow = { sum: string | number | null };
  const budgetRows = (await tx
    .select({
      sum: sql<string | number | null>`COALESCE(SUM(${campaigns.budgetCents}), 0)::int`,
    })
    .from(campaigns)
    .where(
      and(
        eq(campaigns.organizationId, orgId),
        sql`${campaigns.status} <> 'archived'`,
      ),
    )) as BudgetRow[];
  const totalBudgetCents = toNum(budgetRows[0]?.sum ?? 0) ?? 0;

  return {
    active: byStatus.active ?? 0,
    draft: byStatus.draft ?? 0,
    paused: byStatus.paused ?? 0,
    completed: byStatus.completed ?? 0,
    archived: byStatus.archived ?? 0,
    totalBudgetCents,
  };
}

// ---------------------------------------------------------------------------
// Posts by campaign (Posts tab on the detail page)
// ---------------------------------------------------------------------------

/**
 * Returns post ids associated with a campaign. The detail page
 * passes those ids back to `listPostsForOrg`-like reading paths so
 * the existing `PostListItem` shape (target counts, last error,
 * retry count) is reused without duplication.
 */
export async function getPostsByCampaignWithTx(
  tx: AnyPgTx,
  opts: { orgId: string; campaignId: string; limit?: number },
): Promise<ReadonlyArray<string>> {
  const rows = (await tx
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.organizationId, opts.orgId),
        eq(posts.campaignId, opts.campaignId),
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(opts.limit ?? 200)) as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
