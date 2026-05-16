'use server';

import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { decodeReviewCursor } from '@/lib/reviews/cursor';
import type { ReviewFilters } from '@/lib/reviews/filters';
import { listReviews, type ReviewListPage } from '@/lib/reviews/queries';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Load-more pagination for /reviews. Sibling of
 * `app/(app)/inbox/load-more-action.ts` (Commit 8).
 *
 * The same filters that drove the first page are echoed back from the
 * client so the cursor predicate keeps producing the same ordering;
 * platform gating already happened on the page render — the
 * `ReviewFilters` object that arrives here is already trimmed to the
 * caller's plan.
 *
 * RBAC happens here too (not just on the page) because Server Actions
 * are independently addressable endpoints — a stale tab or a manual
 * client call must still pass `authorize`.
 */
export async function loadMoreReviewsAction(input: {
  cursor: string;
  filters: ReviewFilters;
}): Promise<Result<ReviewListPage>> {
  const session = await requireUser();
  authorize(session.role, 'reviews:read');

  const cursor = decodeReviewCursor(input.cursor);
  if (!cursor) {
    return err('VALIDATION_ERROR', 'Cursor inválido.');
  }

  // Re-resolve the plan server-side. A stale client filter set that
  // names a gated platform must still hit the defensive intersection
  // inside `listReviews` — not just the page-render parser.
  const plan = await getOrgPlanCode(session);

  const page = await listReviews({
    orgId: session.orgId,
    userId: session.userId,
    filters: input.filters,
    cursor,
    plan,
  });
  return ok(page);
}
