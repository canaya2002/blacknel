import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { ComposerShell } from '@/components/publish/composer/composer-shell';
import {
  FailedPostBanner,
  PendingApprovalBanner,
} from '@/components/publish/composer/composer-status-banners';
import { requireUser } from '@/lib/auth/server';
import { pendingApprovalForPost } from '@/lib/approvals/queries';
import { authorize } from '@/lib/permissions/can';
import { loadComposerData } from '@/lib/publish/composer/loader';
import { MAX_RETRY_COUNT } from '@/lib/jobs/publish-target';
import { getOrgPlanCode } from '@/lib/queries/plan';

export const dynamic = 'force-dynamic';

interface ComposerPageProps {
  params: Promise<{ id: string }>;
}

const idSchema = z.string().uuid();

/**
 * /publish/composer/[id] — Commit 20b update.
 *
 * Render branches by `post.status`:
 *
 *   - `draft`               → editable composer, no banner.
 *   - `pending_approval`    → read-only composer + PendingApprovalBanner
 *                             with deep-link to /approvals/[id].
 *   - `failed`              → read-only composer + FailedPostBanner
 *                             with last error + RetryButton.
 *   - any other terminal /  → NonEditableNotice (calendar back-link).
 *     in-flight status
 */
export default async function ComposerEditorPage({
  params,
}: ComposerPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'posts:create');

  const { id } = await params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) notFound();

  const [data, planCode] = await Promise.all([
    loadComposerData({
      orgId: session.orgId,
      userId: session.userId,
      postId: parsedId.data,
    }),
    getOrgPlanCode(session),
  ]);
  if (!data) notFound();

  const status = data.postDetail.status;
  const isReadOnlyComposer =
    status === 'pending_approval' || status === 'failed';
  const isEditable = status === 'draft';
  const showComposer = isEditable || isReadOnlyComposer;

  if (!showComposer) {
    return (
      <div className="flex flex-col">
        <NonEditableNotice status={status} />
      </div>
    );
  }

  // Pending approval — fetch the active approval row so the banner
  // can deep-link. There is at most one (apply-schedule.ts only
  // inserts one approval per post).
  const approval =
    status === 'pending_approval'
      ? await pendingApprovalForPost({
          orgId: session.orgId,
          userId: session.userId,
          postId: parsedId.data,
        })
      : null;

  // Failed — surface the most recent target error + the max
  // retry_count for the chip. Reads from the post detail we
  // already loaded (no extra round-trip).
  const failedTargets = data.postDetail.targets.filter(
    (t) => t.status === 'failed',
  );
  const lastError =
    failedTargets.find((t) => t.errorMessage)?.errorMessage ?? null;
  const maxRetryCountForRow = failedTargets.reduce(
    (acc, t) => Math.max(acc, t.retryCount),
    0,
  );

  return (
    <div className="flex flex-col">
      {status === 'pending_approval' && approval ? (
        <PendingApprovalBanner
          approvalId={approval.id}
          riskLevel={approval.riskLevel}
          createdAt={approval.createdAt}
        />
      ) : null}
      {status === 'failed' ? (
        <FailedPostBanner
          postId={data.postDetail.id}
          lastError={lastError}
          retryCount={maxRetryCountForRow}
          maxRetryCount={MAX_RETRY_COUNT}
        />
      ) : null}
      <ComposerShell
        data={data}
        planCode={planCode}
        readOnly={isReadOnlyComposer}
      />
    </div>
  );
}

function NonEditableNotice({ status }: { status: string }): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
      <h2 className="text-lg font-semibold tracking-tight">
        Este post ya no se puede editar
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Estado actual: <span className="font-medium">{status}</span>. Para
        modificar el contenido, cancela el post o duplícalo desde el calendario.
      </p>
      <Button asChild variant="outline" size="sm">
        <Link href="/publish" prefetch={false}>
          Volver al calendario
        </Link>
      </Button>
    </div>
  );
}
