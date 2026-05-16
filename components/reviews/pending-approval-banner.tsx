import { Clock, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface PendingApprovalBannerProps {
  approvals: ReadonlyArray<{ id: string; createdAt: Date; riskLevel: string }>;
}

/**
 * Bidirectional banner above the response composer. Same shape as the
 * inbox banner (Commit 10) — different copy. The link target is
 * `/approvals/[id]` for the first pending approval; clicking it lands
 * the user on the queue surface where they (or a manager with
 * `approvals:decide`) can read the diff and decide.
 *
 * Bidirectional: on /approvals/[approvalId] for a `review_response`
 * kind, a sibling link points back here ("Review origen → /reviews/X").
 */
export function PendingApprovalBanner({
  approvals,
}: PendingApprovalBannerProps): React.ReactElement {
  const first = approvals[0]!;
  return (
    <div className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">
        {approvals.length === 1
          ? 'Hay 1 respuesta pendiente de aprobación → /approvals.'
          : `Hay ${approvals.length} respuestas pendientes de aprobación → /approvals.`}
      </span>
      <Link
        href={`/approvals/${first.id}` as `/approvals/${string}`}
        className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      >
        Ver
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}
