import 'server-only';

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { PlatformCode } from '../connectors/base';
import { type AnyPgTx, dbAs } from '../db/client';
import { locations, reviewResponses, reviews } from '../db/schema';
import { planAllowsPlatform } from '../plans/gating';
import { type PlanCode } from '../plans/plans';

import { encodeReviewCursor, type ReviewCursor } from './cursor';
import type { ReviewFilters } from './filters';

/**
 * Listing primitives for /reviews. Mirrors `lib/inbox/queries.ts`
 * (Commit 8): every read goes through `dbAs` so RLS enforces tenant
 * isolation, with a redundant `eq(reviews.organizationId, orgId)`
 * predicate as defense in depth that also helps the planner pick
 * `reviews_org_posted_idx`.
 *
 * # Pagination
 *
 * Cursor-based on `(posted_at DESC, id DESC)`. Query `LIMIT pageSize+1`;
 * the extra row signals "has more?" and its sort tuple becomes the
 * next cursor.
 *
 * # Capability gating: `canReply`
 *
 * Yelp Fusion API is read-only. Rather than ship a reply button on
 * Yelp rows that errors when clicked, the row-level `canReply` flag
 * tells the UI in advance — the button is hidden / disabled at render
 * time. The flag is computed in the projection, not via a JOIN to the
 * connector registry, because the connector registry is application
 * code; doing the lookup at projection time keeps the SQL self-
 * contained while still leaving capabilities a single source of truth
 * (the registry exposes the same answer for any consumer).
 *
 * # Response state: `hasPublishedResponse`
 *
 * Surfaced via a correlated EXISTS subquery on `review_responses`. Cheap
 * at page size 50 thanks to `review_responses_review_idx`. Drives the
 * "already responded" badge on the row without forcing the page to load
 * the full response body.
 */

const DEFAULT_PAGE_SIZE = 50;

/** Stable shape consumed by client components. */
export interface ReviewListItem {
  readonly id: string;
  readonly platform: string;
  readonly rating: number;
  readonly sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  readonly status: 'pending' | 'in_progress' | 'responded' | 'archived' | 'spam';
  readonly escalated: boolean;
  readonly postedAt: Date;
  readonly assignedTo: string | null;
  readonly authorName: string | null;
  readonly authorAvatar: string | null;
  readonly bodyExcerpt: string;
  readonly tags: ReadonlyArray<string>;
  readonly brandId: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly hasPublishedResponse: boolean;
  /**
   * Computed from the connector capability matrix. `false` for Yelp
   * (read-only Fusion API); `true` for every other platform Blacknel
   * imports reviews from. The UI uses this to hide the reply button.
   */
  readonly canReply: boolean;
  /**
   * Phase 10 / Commit 38 — render-only per-platform extension fields
   * (Yelp elite_reviewer, BBB complaint_status, TripAdvisor
   * category_ratings, …). Validated by
   * `lib/reviews/platform-specific-schemas.ts`. The UI consumes via
   * `<components/reviews/platform-extras>`. STRICT RENDER-ONLY RULE
   * — never used in WHERE / ORDER BY / GROUP BY.
   */
  readonly platformSpecific: Record<string, unknown> | null;
}

export interface ReviewListPage {
  readonly reviews: ReadonlyArray<ReviewListItem>;
  readonly nextCursor: string | null;
}

export interface ListReviewsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: ReviewFilters;
  readonly cursor: ReviewCursor | null;
  readonly pageSize?: number;
  /**
   * Optional server-side plan enforcement (master-prompt rule 8: "feature
   * gating en server, no solo UI"). When provided, `filters.platform` is
   * intersected with the plan's allowed networks before the SQL runs:
   *
   *   - A Growth caller passing `platform: ['yelp']` gets an empty page
   *     because Yelp drops out of the intersection and the resulting
   *     empty filter set is treated as "no platforms match".
   *   - A caller passing `platform: ['facebook', 'yelp']` on Growth
   *     sees only Facebook rows (Yelp stripped silently).
   *
   * The /reviews page already gates platforms at parse time so this
   * second layer is defense in depth — a Server Action that bypasses
   * the parser (load-more, future bulk export) still can't leak gated
   * rows.
   */
  readonly plan?: PlanCode;
}

/**
 * Platforms whose connector declares `reply_reviews`. Yelp is the only
 * imported-reviews platform that does NOT — the read-only Fusion API.
 * Defined here (not imported from the connector registry) so the SQL
 * projection stays self-contained; the registry remains the *source of
 * truth* and these flags ride alongside as a query-time derivation.
 */
const REPLY_CAPABLE_PLATFORMS = new Set<string>([
  'facebook',
  'instagram',
  'gbp',
  'tripadvisor',
  'trustpilot',
  'bbb',
  'avvo',
  'youtube',
  // Yelp is intentionally absent.
]);

const MAX_EXCERPT = 240;

export async function listReviews(opts: ListReviewsOpts): Promise<ReviewListPage> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) => listReviewsWithTx(tx, opts),
  );
}

/**
 * Same query as `listReviews`, but takes an existing transaction. Used by
 * integration tests that run inside `runAs(testDb, ctx, ...)`.
 */
export async function listReviewsWithTx(
  tx: AnyPgTx,
  opts: ListReviewsOpts,
): Promise<ReviewListPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const { orgId, userId, filters, cursor, plan } = opts;

  // Server-side plan enforcement (see `ListReviewsOpts.plan` doc). When
  // a plan is provided AND the caller asked to filter by platform, we
  // intersect the requested platforms with the plan's allowed networks.
  // An empty intersection short-circuits to an empty page rather than
  // querying for "platform IN ()" (which Postgres rejects as a syntax
  // error). The caller already saw the gated-platform banner on the
  // page render, so an empty result here is the expected outcome.
  let effectivePlatforms = filters.platform;
  if (plan && filters.platform?.length) {
    const intersected: PlatformCode[] = [];
    for (const p of filters.platform) {
      if (planAllowsPlatform(plan, p)) intersected.push(p);
    }
    if (intersected.length === 0) {
      return { reviews: [], nextCursor: null };
    }
    effectivePlatforms = intersected;
  }

  const conditions: SQL[] = [eq(reviews.organizationId, orgId)];

  if (filters.status?.length) {
    conditions.push(
      inArray(reviews.status, filters.status as Array<typeof filters.status[number]>),
    );
  }
  if (filters.rating?.length) {
    conditions.push(inArray(reviews.rating, filters.rating as number[]));
  }
  if (filters.sentiment?.length) {
    conditions.push(
      inArray(reviews.sentiment, filters.sentiment as Array<typeof filters.sentiment[number]>),
    );
  }
  if (effectivePlatforms?.length) {
    conditions.push(inArray(reviews.platform, effectivePlatforms as string[]));
  }
  if (filters.brandId) {
    conditions.push(eq(reviews.brandId, filters.brandId));
  }
  if (filters.locationId) {
    conditions.push(eq(reviews.locationId, filters.locationId));
  }
  if (filters.assignedTo === 'unassigned') {
    conditions.push(isNull(reviews.assignedTo));
  } else if (filters.assignedTo === 'me') {
    conditions.push(eq(reviews.assignedTo, userId));
  } else if (typeof filters.assignedTo === 'string') {
    conditions.push(eq(reviews.assignedTo, filters.assignedTo));
  }
  if (filters.dateFrom) {
    conditions.push(
      gte(reviews.postedAt, sql`${filters.dateFrom}::timestamptz`),
    );
  }
  if (filters.dateTo) {
    // dateTo is inclusive at day granularity → predicate is "< dateTo + 1 day"
    // so postings made at 23:59 on the upper-bound day still match.
    conditions.push(
      lt(reviews.postedAt, sql`(${filters.dateTo}::date + interval '1 day')`),
    );
  }
  if (filters.q) {
    // Phase-5 fallback: ILIKE on the body. Reviews don't yet have the
    // tsvector column inbox messages have (TODO inbox-fts-trigram is
    // still open — pg_trgm not in pglite default). For 80-200 reviews
    // ILIKE is fine; the GIN/tsvector upgrade lands with Phase 11
    // alongside the inbox-fts-trigram fix.
    conditions.push(
      sql`${reviews.body} ILIKE ${'%' + filters.q.replace(/[\\%_]/g, (m) => '\\' + m) + '%'}`,
    );
  }
  if (cursor) {
    conditions.push(
      sql`(${reviews.postedAt}, ${reviews.id}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`,
    );
  }

  type Row = {
    id: string;
    platform: string;
    rating: number;
    sentiment: ReviewListItem['sentiment'];
    status: ReviewListItem['status'];
    escalated: boolean;
    postedAt: Date;
    assignedTo: string | null;
    authorName: string | null;
    authorAvatar: string | null;
    bodyExcerpt: string;
    tags: unknown;
    brandId: string | null;
    locationId: string | null;
    locationName: string | null;
    hasPublishedResponse: boolean;
    platformSpecific: unknown;
  };

  const rows: Row[] = await tx
    .select({
      id: reviews.id,
      platform: reviews.platform,
      rating: reviews.rating,
      sentiment: reviews.sentiment,
      status: reviews.status,
      escalated: reviews.escalated,
      postedAt: reviews.postedAt,
      assignedTo: reviews.assignedTo,
      authorName: reviews.authorName,
      authorAvatar: reviews.authorAvatar,
      bodyExcerpt: sql<string>`substring(${reviews.body} from 1 for ${MAX_EXCERPT})`.as(
        'body_excerpt',
      ),
      tags: reviews.tags,
      brandId: reviews.brandId,
      locationId: reviews.locationId,
      locationName: locations.name,
      hasPublishedResponse: sql<boolean>`EXISTS (
        SELECT 1 FROM review_responses r
        WHERE r.review_id = ${reviews.id}
          AND r.status = 'published'
      )`.as('has_published_response'),
      platformSpecific: reviews.platformSpecific,
    })
    .from(reviews)
    .leftJoin(locations, eq(locations.id, reviews.locationId))
    .where(and(...conditions))
    .orderBy(desc(reviews.postedAt), desc(reviews.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const visible = hasMore ? rows.slice(0, pageSize) : rows;
  const tail = visible[visible.length - 1];
  const nextCursor =
    hasMore && tail
      ? encodeReviewCursor({ t: tail.postedAt.toISOString(), i: tail.id })
      : null;

  return {
    reviews: visible.map(
      (r): ReviewListItem => ({
        id: r.id,
        platform: r.platform,
        rating: r.rating,
        sentiment: r.sentiment,
        status: r.status,
        escalated: r.escalated,
        postedAt: r.postedAt,
        assignedTo: r.assignedTo,
        authorName: r.authorName,
        authorAvatar: r.authorAvatar,
        bodyExcerpt: r.bodyExcerpt ?? '',
        tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
        brandId: r.brandId,
        locationId: r.locationId,
        locationName: r.locationName,
        hasPublishedResponse: Boolean(r.hasPublishedResponse),
        canReply: REPLY_CAPABLE_PLATFORMS.has(r.platform),
        platformSpecific:
          r.platformSpecific && typeof r.platformSpecific === 'object'
            ? (r.platformSpecific as Record<string, unknown>)
            : null,
      }),
    ),
    nextCursor,
  };
}

/**
 * Cheap "does the org have ANY reviews?" probe used to pick between the
 * "no reviews ever" empty state and the "no matches" / "narrow slice"
 * branches. Same pattern as `orgHasAnyThreads` in inbox queries —
 * `LIMIT 1` so RLS + the org-status idx make this an index seek.
 */
export async function orgHasAnyReviews(opts: {
  orgId: string;
  userId: string;
}): Promise<boolean> {
  const rows = await dbAs<Array<{ id: string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(eq(reviews.organizationId, opts.orgId))
        .limit(1),
  );
  return rows.length > 0;
}

/**
 * Same probe but inside a caller-managed transaction (integration
 * tests). Symmetrical to `listReviewsWithTx`.
 */
export async function orgHasAnyReviewsWithTx(
  tx: AnyPgTx,
  opts: { orgId: string },
): Promise<boolean> {
  const rows = await tx
    .select({ id: reviews.id })
    .from(reviews)
    .where(eq(reviews.organizationId, opts.orgId))
    .limit(1);
  return rows.length > 0;
}

// Touch the import so a future PR that drops `reviewResponses` from
// `lib/db/schema/index.ts` fails at build time on this module too — the
// EXISTS subquery references the table by raw name, so without this
// touch the dependency would be invisible to TS.
void reviewResponses;
