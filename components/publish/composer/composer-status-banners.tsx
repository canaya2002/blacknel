import { AlertTriangle, ClipboardCheck, ExternalLink } from 'lucide-react';
import Link from 'next/link';

import { RetryButton } from '@/components/publish/retry-button';
import { Badge } from '@/components/ui/badge';

/**
 * Bidirectional banners that ride above the composer when the post
 * isn't actively editable (Commit 20b). Two states the composer
 * still renders for (read-only):
 *
 *   - `pending_approval` → `<PendingApprovalBanner />` linking to
 *     the approval queue entry. The composer subtree is wrapped in
 *     a `<fieldset disabled>` (see composer-shell.tsx) so the user
 *     can read the staged content but can't edit while a manager
 *     is deciding.
 *
 *   - `failed` → `<FailedPostBanner />` with the last error +
 *     retry-count chip + a manual `<RetryButton />` (calls
 *     `retryFailedPostAction`). The fieldset disables editing
 *     until the user clicks "Editar y reintentar" — which moves
 *     the post back to `draft` via the action's status transition.
 *
 * Both banners are Server Components — the only Client surface is
 * `<RetryButton />` for its `useTransition`.
 */

interface PendingApprovalBannerProps {
  approvalId: string;
  riskLevel: string;
  createdAt: Date;
}

export function PendingApprovalBanner({
  approvalId,
  riskLevel,
  createdAt,
}: PendingApprovalBannerProps): React.ReactElement {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-amber-500/30 bg-amber-500/5 px-6 py-3">
      <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Este post está en aprobación
          </span>
          <Badge variant="muted" className="text-[10px] uppercase">
            risk: {riskLevel}
          </Badge>
        </div>
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
          La edición está bloqueada mientras un manager decide. Solicitada{' '}
          <time dateTime={createdAt.toISOString()}>
            {createdAt.toLocaleString()}
          </time>
          .
        </p>
      </div>
      <Link
        href={`/approvals/${approvalId}` as `/approvals/${string}`}
        prefetch={false}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-100/40 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100/70 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
      >
        Ver aprobación
        <ExternalLink className="h-3 w-3" aria-hidden />
      </Link>
    </div>
  );
}

interface FailedPostBannerProps {
  postId: string;
  lastError: string | null;
  retryCount: number;
  maxRetryCount: number;
}

export function FailedPostBanner({
  postId,
  lastError,
  retryCount,
  maxRetryCount,
}: FailedPostBannerProps): React.ReactElement {
  const reachedCap = retryCount >= maxRetryCount;
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-red-500/30 bg-red-500/5 px-6 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-red-900 dark:text-red-100">
            La publicación falló
          </span>
          <Badge variant="muted" className="text-[10px] uppercase">
            intentos {retryCount}/{maxRetryCount}
          </Badge>
          {reachedCap ? (
            <Badge variant="muted" className="text-[10px] uppercase">
              tope de reintentos alcanzado
            </Badge>
          ) : null}
        </div>
        {lastError ? (
          <p className="text-xs text-red-900/80 dark:text-red-100/80">
            <span className="font-medium">Último error:</span>{' '}
            <code className="rounded bg-red-100/60 px-1 dark:bg-red-950/40">
              {lastError}
            </code>
          </p>
        ) : (
          <p className="text-xs text-red-900/80 dark:text-red-100/80">
            La razón exacta no quedó registrada — revisa los logs de auditoría.
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <RetryButton postId={postId} variant="banner" />
      </div>
    </div>
  );
}
