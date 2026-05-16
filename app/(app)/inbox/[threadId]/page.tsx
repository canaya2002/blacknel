import { notFound } from 'next/navigation';

import { PendingApprovalBanner } from '@/components/inbox/pending-approval-banner';
import { Composer } from '@/components/inbox/composer';
import { ContextPanel } from '@/components/inbox/context-panel';
import { ThreadDetailPolling } from '@/components/inbox/inbox-polling';
import { ThreadDetailShortcuts } from '@/components/inbox/thread-detail-shortcuts';
import { ThreadDetailView } from '@/components/inbox/thread-detail-view';
import { ThreadHeaderBar } from '@/components/inbox/thread-header-bar';
import { pendingApprovalsForThread } from '@/lib/approvals/queries';
import { requireUser } from '@/lib/auth/server';
import { getThreadDetail, savedRepliesForOrg } from '@/lib/inbox/thread-detail';
import { authorize } from '@/lib/permissions/can';

export const dynamic = 'force-dynamic';

interface ThreadPageProps {
  params: Promise<{ threadId: string }>;
}

export default async function ThreadDetailPage({
  params,
}: ThreadPageProps): Promise<React.ReactElement> {
  const { threadId } = await params;
  const session = await requireUser();
  authorize(session.role, 'inbox:read');

  const [detail, savedReplies, pendingApprovals] = await Promise.all([
    getThreadDetail({ orgId: session.orgId, userId: session.userId, threadId }),
    savedRepliesForOrg({ orgId: session.orgId, userId: session.userId }),
    pendingApprovalsForThread({
      orgId: session.orgId,
      userId: session.userId,
      threadId,
    }),
  ]);
  if (!detail) notFound();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <ThreadDetailPolling />
      <ThreadDetailShortcuts threadId={detail.thread.id} />
      <ThreadHeaderBar thread={detail.thread} />

      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col overflow-hidden border-r">
          {pendingApprovals.length > 0 ? (
            <PendingApprovalBanner approvals={pendingApprovals} />
          ) : null}
          <ThreadDetailView messages={detail.messages} />
          <Composer
            threadId={detail.thread.id}
            initialLanguage={detail.thread.contactLanguage}
            savedReplies={savedReplies}
            threadContext={{
              contactName: detail.thread.contactName,
              locationName: detail.thread.locationName,
              phone: detail.thread.locationPhone,
              // brand/business_hours come from brand metadata once that
              // schema lands — Phase 4 leaves them as null so the
              // composer treats `{business_hours}` as unresolved.
              businessHours: null,
              link: null,
            }}
          />
        </div>

        <ContextPanel thread={detail.thread} notes={detail.notes} />
      </div>
    </div>
  );
}
