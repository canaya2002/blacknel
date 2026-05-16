import { notFound } from 'next/navigation';

import { PendingApprovalBanner } from '@/components/reviews/pending-approval-banner';
import { ResponseComposer } from '@/components/reviews/response-composer';
import { ResponsesHistory } from '@/components/reviews/responses-history';
import { ReviewHeader } from '@/components/reviews/review-header';
import { pendingApprovalsForReview } from '@/lib/approvals/queries';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { getReviewDetail } from '@/lib/reviews/review-detail';

export const dynamic = 'force-dynamic';

interface ReviewDetailPageProps {
  params: Promise<{ reviewId: string }>;
}

/**
 * /reviews/[reviewId] — Commit 14.
 *
 * Layout: review header (stars + body + tags) → pending-approval
 * banner (bidirectional with /approvals) → responses history →
 * composer. The composer self-disables and shows a notice when
 * `canReply=false` (Yelp).
 *
 * The pending-approval banner is the bidirectional twin of the
 * "Review origen → /reviews/X" link on /approvals/[approvalId]
 * (added in this same commit). Same UX shape as inbox+approvals
 * (Commit 10).
 */
export default async function ReviewDetailPage({
  params,
}: ReviewDetailPageProps): Promise<React.ReactElement> {
  const { reviewId } = await params;
  const session = await requireUser();
  authorize(session.role, 'reviews:read');

  const [detail, pendingApprovals] = await Promise.all([
    getReviewDetail({
      orgId: session.orgId,
      userId: session.userId,
      reviewId,
    }),
    pendingApprovalsForReview({
      orgId: session.orgId,
      userId: session.userId,
      reviewId,
    }),
  ]);
  if (!detail) notFound();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">
      <ReviewHeader review={detail.review} />

      {pendingApprovals.length > 0 ? (
        <PendingApprovalBanner approvals={pendingApprovals} />
      ) : null}

      <div className="flex-1 overflow-y-auto">
        <ResponsesHistory responses={detail.responses} />
      </div>

      <ResponseComposer
        reviewId={detail.review.id}
        rating={detail.review.rating}
        canReply={detail.review.canReply}
      />
    </div>
  );
}
