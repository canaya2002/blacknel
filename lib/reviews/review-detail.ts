import 'server-only';

import { and, asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { dbAs } from '../db/client';
import {
  brands,
  locations,
  reviewResponses,
  reviews,
  users,
} from '../db/schema';

/**
 * Aggregator for /reviews/[reviewId]. Three RLS-scoped reads under the
 * same `dbAs` context:
 *
 *   1. Review header with brand + location + assignee names joined.
 *   2. Full response history ordered by `createdAt ASC` so the
 *      timeline reads top-to-bottom.
 *
 * Same shape contract as `lib/inbox/thread-detail.ts` (Commit 9) so
 * future shared infra can target both modules.
 */

export interface ReviewDetail {
  readonly review: ReviewHeader;
  readonly responses: ReadonlyArray<ResponseRow>;
}

export interface ReviewHeader {
  readonly id: string;
  readonly platform: string;
  readonly externalReviewId: string | null;
  readonly rating: number;
  readonly sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  readonly status: 'pending' | 'in_progress' | 'responded' | 'archived' | 'spam';
  readonly escalated: boolean;
  readonly postedAt: Date;
  readonly language: string | null;
  readonly authorName: string | null;
  readonly authorAvatar: string | null;
  readonly body: string;
  readonly tags: ReadonlyArray<string>;
  readonly assignedTo: string | null;
  readonly assigneeName: string | null;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  /**
   * `true` if the platform's connector declares `reply_reviews`. Yelp
   * is the only imported-reviews platform that doesn't. The composer
   * hides itself when this is `false`.
   */
  readonly canReply: boolean;
}

export interface ResponseRow {
  readonly id: string;
  readonly status: 'draft' | 'pending_approval' | 'approved' | 'published' | 'rejected';
  readonly draftText: string | null;
  readonly finalText: string | null;
  readonly aiGenerated: boolean;
  readonly complianceScore: number | null;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly publishedAt: Date | null;
  readonly createdAt: Date;
  readonly externalResponseId: string | null;
}

/**
 * Platforms whose connector declares `reply_reviews`. Mirrors the set
 * in `lib/reviews/queries.ts` — kept here too so we don't pay a
 * registry import on the detail page. The registry remains the source
 * of truth; if it changes, both lists need updating (a unit test
 * would catch the drift if we add one).
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
]);

export async function getReviewDetail(opts: {
  orgId: string;
  userId: string;
  reviewId: string;
}): Promise<ReviewDetail | null> {
  const { orgId, userId, reviewId } = opts;

  const assigneeUsers = alias(users, 'review_assignee_users');

  type HeaderRow = Omit<ReviewHeader, 'tags' | 'canReply'> & { tags: unknown };

  const headerRows: HeaderRow[] = await dbAs(
    { orgId, userId },
    async (tx) =>
      tx
        .select({
          id: reviews.id,
          platform: reviews.platform,
          externalReviewId: reviews.externalReviewId,
          rating: reviews.rating,
          sentiment: reviews.sentiment,
          status: reviews.status,
          escalated: reviews.escalated,
          postedAt: reviews.postedAt,
          language: reviews.language,
          authorName: reviews.authorName,
          authorAvatar: reviews.authorAvatar,
          body: reviews.body,
          tags: reviews.tags,
          assignedTo: reviews.assignedTo,
          assigneeName: assigneeUsers.name,
          brandId: reviews.brandId,
          brandName: brands.name,
          locationId: reviews.locationId,
          locationName: locations.name,
        })
        .from(reviews)
        .leftJoin(brands, eq(brands.id, reviews.brandId))
        .leftJoin(locations, eq(locations.id, reviews.locationId))
        .leftJoin(assigneeUsers, eq(assigneeUsers.id, reviews.assignedTo))
        .where(and(eq(reviews.id, reviewId), eq(reviews.organizationId, orgId)))
        .limit(1) as unknown as Promise<HeaderRow[]>,
  );
  const header = headerRows[0];
  if (!header) return null;

  type ResponseQueryRow = Omit<ResponseRow, 'authorName'> & {
    authorName: string | null;
  };

  const responses: ResponseQueryRow[] = await dbAs(
    { orgId, userId },
    async (tx) =>
      tx
        .select({
          id: reviewResponses.id,
          status: reviewResponses.status,
          draftText: reviewResponses.draftText,
          finalText: reviewResponses.finalText,
          aiGenerated: reviewResponses.aiGenerated,
          complianceScore: reviewResponses.complianceScore,
          authorId: reviewResponses.authorId,
          authorName: users.name,
          publishedAt: reviewResponses.publishedAt,
          createdAt: reviewResponses.createdAt,
          externalResponseId: reviewResponses.externalResponseId,
        })
        .from(reviewResponses)
        .leftJoin(users, eq(users.id, reviewResponses.authorId))
        .where(eq(reviewResponses.reviewId, reviewId))
        .orderBy(asc(reviewResponses.createdAt))
        .limit(50) as unknown as Promise<ResponseQueryRow[]>,
  );

  return {
    review: {
      ...header,
      tags: Array.isArray(header.tags) ? (header.tags as string[]) : [],
      canReply: REPLY_CAPABLE_PLATFORMS.has(header.platform),
    },
    responses,
  };
}
