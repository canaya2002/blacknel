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
import { dbAs } from '@/lib/db/client';
import { getThreadDetail, savedRepliesForOrg } from '@/lib/inbox/thread-detail';
import { authorize } from '@/lib/permissions/can';
import { listApprovedTemplatesForAccount } from '@/lib/whatsapp/queries';
import { connectedAccounts, whatsappAccounts } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

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

  // WhatsApp templates only when the thread is WhatsApp (Phase 9 /
  // Commit 31). We hop thread → connected_account → whatsapp_account
  // and pull approved templates for that WABA. Non-WhatsApp threads
  // skip the query entirely.
  const whatsappTemplates =
    detail.thread.platform === 'whatsapp'
      ? await loadApprovedWaTemplatesForThread(session, detail.thread.id)
      : [];

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
            whatsappTemplates={whatsappTemplates}
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

async function loadApprovedWaTemplatesForThread(
  session: { orgId: string; userId: string },
  threadId: string,
): Promise<
  ReadonlyArray<{
    id: string;
    name: string;
    language: string;
    body: string;
    variables: ReadonlyArray<{ position: number; label: string }>;
  }>
> {
  // Find the whatsapp_account behind this thread via
  // inbox_threads.connected_account_id (Phase 4) → whatsapp_accounts.
  // Returns [] when the thread has no connected account or no WABA
  // pair (defensive — should not happen for synced WhatsApp threads).
  const waAccountId = await dbAs<Array<{ waId: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({ waId: whatsappAccounts.id })
        .from(whatsappAccounts)
        .innerJoin(
          connectedAccounts,
          eq(connectedAccounts.id, whatsappAccounts.connectedAccountId),
        )
        .where(
          and(
            eq(whatsappAccounts.organizationId, session.orgId),
            eq(connectedAccounts.platform, 'whatsapp'),
          ),
        )
        .limit(1),
  );
  if (waAccountId.length === 0) return [];
  // Touch `threadId` so a future commit that wants per-thread scoping
  // (e.g. WABA-per-brand) has a single point to wire.
  void threadId;
  const templates = await listApprovedTemplatesForAccount({
    orgId: session.orgId,
    userId: session.userId,
    whatsappAccountId: waAccountId[0]!.waId,
  });
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    language: t.language,
    body: t.body,
    variables: t.variables,
  }));
}
