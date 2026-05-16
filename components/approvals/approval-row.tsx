'use client';

import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import type { ApprovalListItem } from '@/lib/approvals/queries';
import { cn } from '@/lib/utils/cn';

interface ApprovalRowProps {
  approval: ApprovalListItem;
}

const STATUS_TONE: Record<ApprovalListItem['status'], string> = {
  pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
  edited_approved: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  escalated: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  expired: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const RISK_TONE: Record<ApprovalListItem['riskLevel'], string> = {
  low: 'text-zinc-500',
  medium: 'text-amber-600 dark:text-amber-400',
  high: 'text-orange-600 dark:text-orange-400',
  critical: 'text-red-600 dark:text-red-400',
};

function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.round(d / 7)}sem`;
}

export function ApprovalRow({ approval }: ApprovalRowProps): React.ReactElement {
  return (
    <Link
      href={`/approvals/${approval.id}` as `/approvals/${string}`}
      className="flex items-start gap-3 border-b px-4 py-3 transition-colors hover:bg-accent/40"
      data-testid="approval-row"
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border',
          approval.riskLevel === 'critical' || approval.riskLevel === 'high'
            ? 'border-red-500/40 bg-red-500/10'
            : 'border-amber-500/40 bg-amber-500/10',
        )}
        aria-hidden
      >
        <AlertTriangle className={cn('h-4 w-4', RISK_TONE[approval.riskLevel])} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {approval.kind === 'inbox_reply' ? 'Respuesta de inbox' : approval.kind}
          </span>
          <span className={cn('text-[10px] uppercase', RISK_TONE[approval.riskLevel])}>
            {approval.riskLevel}
          </span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              STATUS_TONE[approval.status],
            )}
          >
            {approval.status.replace(/_/g, ' ')}
          </span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {timeAgo(approval.createdAt)}
          </span>
        </div>

        {approval.proposedPreview ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {approval.proposedPreview}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {approval.aiRiskFlags.slice(0, 4).map((flag) => (
            <Badge key={flag} variant="muted" className="text-[10px]">
              {flag.replace(/_/g, ' ')}
            </Badge>
          ))}
          {approval.requestedByName ? (
            <span className="text-[10px] text-muted-foreground">
              por {approval.requestedByName}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
