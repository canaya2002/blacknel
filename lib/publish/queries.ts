import 'server-only';

import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type AnyPgTx, dbAs } from '../db/client';
import {
  brands,
  campaigns,
  connectedAccounts,
  postTargets,
  posts,
  users,
} from '../db/schema';

/**
 * Read paths for /publish (Commit 18 onward). Same shape as the
 * inbox / reviews / reputation query modules: every read goes
 * through `dbAs` so RLS evaluates exactly as production; the
 * redundant `eq(posts.organizationId, orgId)` predicate is
 * defense-in-depth and helps the planner pick the right index.
 *
 * # Surface
 *
 *   - `listPostsForOrg` / `listPostsWithTx`     — list view + filters.
 *   - `getPostDetail`                           — single post + per-target rows.
 *   - `getPostKpiCounts`                        — counts by status for the page header.
 *
 * The list query joins:
 *   - `campaigns.name` (LEFT — campaign is optional)
 *   - `brands.name`    (LEFT — brand may be NULL)
 *   - `users.name`     (LEFT — author may be deleted)
 *   - target count + first-error-message aggregates
 */

const DEFAULT_PAGE_SIZE = 50;

export type PostListStatus =
  | 'draft'
  | 'pending_approval'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export interface PostListItem {
  readonly id: string;
  readonly status: PostListStatus;
  readonly text: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly scheduledAt: Date | null;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  /** Number of target rows (1 per destination account). */
  readonly targetCount: number;
  /** Number of targets currently in `published` status. */
  readonly publishedTargetCount: number;
}

export interface PostListPage {
  readonly posts: ReadonlyArray<PostListItem>;
  readonly nextCursor: string | null;
}

export interface PostListFilters {
  readonly status?: ReadonlyArray<PostListStatus>;
  readonly brandId?: string;
  readonly campaignId?: string;
  readonly q?: string;
  /** ISO date YYYY-MM-DD. Inclusive. */
  readonly scheduledFrom?: string;
  /** ISO date YYYY-MM-DD. Inclusive. */
  readonly scheduledTo?: string;
}

export interface ListPostsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: PostListFilters;
  readonly pageSize?: number;
}

export async function listPostsForOrg(opts: ListPostsOpts): Promise<PostListPage> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) => listPostsWithTx(tx, opts),
  );
}

export async function listPostsWithTx(
  tx: AnyPgTx,
  opts: ListPostsOpts,
): Promise<PostListPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const conditions: SQL[] = [eq(posts.organizationId, opts.orgId)];

  if (opts.filters.status?.length) {
    conditions.push(
      inArray(posts.status, opts.filters.status as Array<PostListStatus>),
    );
  }
  if (opts.filters.brandId) {
    conditions.push(eq(posts.brandId, opts.filters.brandId));
  }
  if (opts.filters.campaignId) {
    conditions.push(eq(posts.campaignId, opts.filters.campaignId));
  }
  if (opts.filters.q) {
    // ILIKE for Phase 6 — same fallback as /reviews until
    // pg_trgm lands (TODO.md#inbox-fts-trigram covers both).
    conditions.push(
      sql`${posts.text} ILIKE ${'%' + opts.filters.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'}`,
    );
  }
  if (opts.filters.scheduledFrom) {
    conditions.push(
      sql`${posts.scheduledAt} >= ${opts.filters.scheduledFrom}::timestamptz`,
    );
  }
  if (opts.filters.scheduledTo) {
    conditions.push(
      sql`${posts.scheduledAt} < (${opts.filters.scheduledTo}::date + interval '1 day')`,
    );
  }

  type Row = {
    id: string;
    status: PostListStatus;
    text: string;
    brandId: string | null;
    brandName: string | null;
    campaignId: string | null;
    campaignName: string | null;
    authorId: string | null;
    authorName: string | null;
    scheduledAt: Date | null;
    publishedAt: Date | null;
    createdAt: Date;
    targetCount: string | number;
    publishedTargetCount: string | number;
  };

  const rows: Row[] = await tx
    .select({
      id: posts.id,
      status: posts.status,
      text: posts.text,
      brandId: posts.brandId,
      brandName: brands.name,
      campaignId: posts.campaignId,
      campaignName: campaigns.name,
      authorId: posts.authorId,
      authorName: users.name,
      scheduledAt: posts.scheduledAt,
      publishedAt: posts.publishedAt,
      createdAt: posts.createdAt,
      targetCount: sql<string | number>`(
        SELECT COUNT(*)::int FROM post_targets pt WHERE pt.post_id = ${posts.id}
      )`.as('target_count'),
      publishedTargetCount: sql<string | number>`(
        SELECT COUNT(*)::int FROM post_targets pt
        WHERE pt.post_id = ${posts.id} AND pt.status = 'published'
      )`.as('published_target_count'),
    })
    .from(posts)
    .leftJoin(brands, eq(brands.id, posts.brandId))
    .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
    .leftJoin(users, eq(users.id, posts.authorId))
    .where(and(...conditions))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const visible = hasMore ? rows.slice(0, pageSize) : rows;

  return {
    posts: visible.map((r): PostListItem => ({
      id: r.id,
      status: r.status,
      text: r.text,
      brandId: r.brandId,
      brandName: r.brandName,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      authorId: r.authorId,
      authorName: r.authorName,
      scheduledAt: r.scheduledAt,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt,
      targetCount: toNum(r.targetCount) ?? 0,
      publishedTargetCount: toNum(r.publishedTargetCount) ?? 0,
    })),
    // Cursor pagination wires in Commit 18 when the list view
    // lands. Phase-6 Commit-17 surface is server-side only.
    nextCursor: hasMore ? 'TODO_CURSOR' : null,
  };
}

// ---------------------------------------------------------------------------
// Post detail (single post + per-target rows + account names)
// ---------------------------------------------------------------------------

export interface PostTargetView {
  readonly id: string;
  readonly connectedAccountId: string;
  readonly accountDisplayName: string | null;
  readonly accountPlatform: string;
  readonly status: 'pending' | 'publishing' | 'published' | 'failed';
  readonly externalPostId: string | null;
  readonly publishedAt: Date | null;
  readonly errorMessage: string | null;
  readonly attemptCount: number;
  readonly platformVariant: Record<string, unknown>;
}

export interface PostDetail {
  readonly id: string;
  readonly status: PostListStatus;
  readonly text: string;
  readonly mediaIds: ReadonlyArray<string>;
  readonly link: string | null;
  readonly utm: Record<string, unknown>;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly campaignId: string | null;
  readonly campaignName: string | null;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly scheduledAt: Date | null;
  readonly publishedAt: Date | null;
  readonly idempotencyKey: string | null;
  readonly createdAt: Date;
  readonly targets: ReadonlyArray<PostTargetView>;
}

export async function getPostDetail(opts: {
  orgId: string;
  userId: string;
  postId: string;
}): Promise<PostDetail | null> {
  const headerRows = await dbAs<Array<Omit<PostDetail, 'targets' | 'mediaIds' | 'utm'> & { mediaIds: unknown; utm: unknown }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({
          id: posts.id,
          status: posts.status,
          text: posts.text,
          mediaIds: posts.mediaIds,
          link: posts.link,
          utm: posts.utm,
          brandId: posts.brandId,
          brandName: brands.name,
          campaignId: posts.campaignId,
          campaignName: campaigns.name,
          authorId: posts.authorId,
          authorName: users.name,
          scheduledAt: posts.scheduledAt,
          publishedAt: posts.publishedAt,
          idempotencyKey: posts.idempotencyKey,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .leftJoin(brands, eq(brands.id, posts.brandId))
        .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
        .leftJoin(users, eq(users.id, posts.authorId))
        .where(
          and(
            eq(posts.id, opts.postId),
            eq(posts.organizationId, opts.orgId),
          ),
        )
        .limit(1) as unknown as Promise<
        Array<Omit<PostDetail, 'targets' | 'mediaIds' | 'utm'> & { mediaIds: unknown; utm: unknown }>
      >,
  );
  const header = headerRows[0];
  if (!header) return null;

  const targets = await dbAs<Array<PostTargetView & { platformVariant: unknown }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({
          id: postTargets.id,
          connectedAccountId: postTargets.connectedAccountId,
          accountDisplayName: connectedAccounts.displayName,
          accountPlatform: connectedAccounts.platform,
          status: postTargets.status,
          externalPostId: postTargets.externalPostId,
          publishedAt: postTargets.publishedAt,
          errorMessage: postTargets.errorMessage,
          attemptCount: postTargets.attemptCount,
          platformVariant: postTargets.platformVariant,
        })
        .from(postTargets)
        .leftJoin(
          connectedAccounts,
          eq(connectedAccounts.id, postTargets.connectedAccountId),
        )
        .where(eq(postTargets.postId, opts.postId))
        .orderBy(postTargets.connectedAccountId) as unknown as Promise<
        Array<PostTargetView & { platformVariant: unknown }>
      >,
  );

  return {
    ...header,
    mediaIds: Array.isArray(header.mediaIds) ? (header.mediaIds as string[]) : [],
    utm:
      header.utm && typeof header.utm === 'object'
        ? (header.utm as Record<string, unknown>)
        : {},
    targets: targets.map((t): PostTargetView => ({
      ...t,
      platformVariant:
        t.platformVariant && typeof t.platformVariant === 'object'
          ? (t.platformVariant as Record<string, unknown>)
          : {},
    })),
  };
}

// ---------------------------------------------------------------------------
// KPI counts (page header)
// ---------------------------------------------------------------------------

export interface PostKpiCounts {
  readonly drafts: number;
  readonly scheduled: number;
  readonly publishing: number;
  readonly published: number;
  readonly failed: number;
  readonly pendingApproval: number;
}

export async function getPostKpiCounts(opts: {
  orgId: string;
  userId: string;
}): Promise<PostKpiCounts> {
  type Row = { status: PostListStatus; n: string | number };
  const rows = await dbAs<Row[]>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({ status: posts.status, n: count(posts.id) })
        .from(posts)
        .where(eq(posts.organizationId, opts.orgId))
        .groupBy(posts.status),
  );
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, toNum(r.n) ?? 0]));
  return {
    drafts: byStatus.draft ?? 0,
    scheduled: byStatus.scheduled ?? 0,
    publishing: byStatus.publishing ?? 0,
    published: byStatus.published ?? 0,
    failed: byStatus.failed ?? 0,
    pendingApproval: byStatus.pending_approval ?? 0,
  };
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

// Touch the aliased imports for future detail queries that need
// per-target author / brand annotations independently of the
// post-level joins above.
void alias;
