import { PageHeader } from '@/components/common/page-header';
import {
  EmptyReviewsNarrowSlice,
  EmptyReviewsNoMatches,
  EmptyReviewsNoReviews,
} from '@/components/reviews/empty-states';
import { FiltersBar } from '@/components/reviews/filters-bar';
import { GatedPlatformBanner } from '@/components/reviews/gated-platform-banner';
import { ReviewsList } from '@/components/reviews/reviews-list';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { decodeReviewCursor } from '@/lib/reviews/cursor';
import {
  hasActiveFilters,
  isNarrowSlice,
  narrowSliceLabel,
  parseReviewFilters,
} from '@/lib/reviews/filters';
import { listReviews, orgHasAnyReviews } from '@/lib/reviews/queries';

export const dynamic = 'force-dynamic';

interface ReviewsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /reviews — Commit 13. Mirrors the inbox shell (Commit 8): page-level
 * gating + filter parsing + initial list page + empty-state branching,
 * with reviews-specific concerns:
 *
 *   - Plan-gated platforms get dropped from the URL filter and surfaced
 *     in the `<GatedPlatformBanner>` above the list. The dropdown
 *     itself (Ajuste 1) shows every platform — the gated rows are
 *     dimmed and surface an upgrade toast on click.
 *
 *   - Three explicit empty states (Ajuste 5): no reviews at all,
 *     filtered to nothing, or narrowed to a less-common slice
 *     (archived / spam / rating=1).
 *
 * `authorize(role, 'reviews:read')` is the server gate. Every role
 * except none-of-the-above has this — but UI + Server Action duplicate
 * the check because they're independently addressable endpoints.
 */
export default async function ReviewsPage({
  searchParams,
}: ReviewsPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'reviews:read');

  const plan = await getOrgPlanCode(session);

  const sp = await searchParams;
  const { filters, cursor: rawCursor, gatedPlatforms } = parseReviewFilters(sp, {
    plan,
  });
  const cursor = decodeReviewCursor(rawCursor ?? null);

  const [page, hasAny] = await Promise.all([
    listReviews({
      orgId: session.orgId,
      userId: session.userId,
      filters,
      cursor,
      plan,
    }),
    orgHasAnyReviews({ orgId: session.orgId, userId: session.userId }),
  ]);

  const active = hasActiveFilters(filters);
  const narrow = isNarrowSlice(filters);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <PageHeader
        title="Reviews"
        description="Reseñas de Google, TripAdvisor, Trustpilot, Facebook y más, centralizadas. Filtra por rating, sentimiento, ubicación y plataforma; las negativas pasan por aprobación en Commit 14."
      />

      <FiltersBar filters={filters} plan={plan} />

      <GatedPlatformBanner gatedPlatforms={gatedPlatforms} plan={plan} />

      <div className="flex-1 overflow-hidden">
        {page.reviews.length > 0 ? (
          <ReviewsList
            initialReviews={page.reviews}
            initialNextCursor={page.nextCursor}
            filters={filters}
          />
        ) : !hasAny ? (
          <EmptyReviewsNoReviews />
        ) : active && narrow ? (
          <EmptyReviewsNarrowSlice scopeLabel={narrowSliceLabel(filters)} />
        ) : active ? (
          <EmptyReviewsNoMatches />
        ) : (
          // Org has reviews, no filters, yet zero results — only
          // possible when a cursor points past the last page after a
          // refresh. Same defensive branch as inbox.
          <EmptyReviewsNoMatches />
        )}
      </div>
    </div>
  );
}
