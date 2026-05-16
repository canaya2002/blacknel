import { Bot, CheckCircle2, FileEdit, Lock, XCircle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import type { ResponseRow } from '@/lib/reviews/review-detail';

interface ResponsesHistoryProps {
  responses: ReadonlyArray<ResponseRow>;
}

/**
 * Timeline of `review_responses` rows for the active review. Each row
 * shows status, body (draft vs final), author, timestamps, and the
 * AI-generated badge when applicable. Same compact density as inbox
 * messages (Commit 9).
 *
 * Rendering rules:
 *   - `status === 'published'`  → green check + `finalText`.
 *   - `status === 'pending_approval'` → amber lock + `draftText`.
 *   - `status === 'rejected'`    → red X + `draftText` (struck through).
 *   - `status === 'draft'`       → muted pencil + `draftText`.
 */
export function ResponsesHistory({
  responses,
}: ResponsesHistoryProps): React.ReactElement {
  if (responses.length === 0) {
    return (
      <div className="px-6 py-4 text-xs text-muted-foreground">
        Sin respuestas todavía. Usa el compositor de abajo para escribir la
        primera o pedirle una sugerencia a la IA.
      </div>
    );
  }
  return (
    <ol className="flex flex-col divide-y" data-testid="responses-history">
      {responses.map((r) => (
        <ResponseEntry key={r.id} response={r} />
      ))}
    </ol>
  );
}

function ResponseEntry({
  response,
}: {
  response: ResponseRow;
}): React.ReactElement {
  const text = response.finalText ?? response.draftText ?? '';
  return (
    <li className="flex items-start gap-3 px-6 py-3" data-testid="response-row">
      <StatusIcon status={response.status} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <StatusBadge status={response.status} />
          {response.aiGenerated ? (
            <Badge variant="muted" className="gap-1 text-[10px]">
              <Bot className="h-2.5 w-2.5" />
              IA
            </Badge>
          ) : null}
          <span>
            {response.authorName ?? 'Sistema'} ·{' '}
            <time dateTime={response.createdAt.toISOString()}>
              {response.createdAt.toLocaleString()}
            </time>
          </span>
          {response.publishedAt ? (
            <span className="text-emerald-600 dark:text-emerald-400">
              · publicada{' '}
              <time dateTime={response.publishedAt.toISOString()}>
                {response.publishedAt.toLocaleString()}
              </time>
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            'whitespace-pre-wrap text-sm leading-relaxed',
            response.status === 'rejected'
              ? 'text-muted-foreground line-through decoration-red-500/40'
              : 'text-foreground',
          )}
        >
          {text}
        </p>
      </div>
    </li>
  );
}

function StatusIcon({
  status,
}: {
  status: ResponseRow['status'];
}): React.ReactElement {
  switch (status) {
    case 'published':
      return (
        <CheckCircle2
          className="mt-1 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
      );
    case 'pending_approval':
    case 'approved':
      return (
        <Lock
          className="mt-1 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
          aria-hidden
        />
      );
    case 'rejected':
      return (
        <XCircle
          className="mt-1 h-4 w-4 shrink-0 text-red-600 dark:text-red-400"
          aria-hidden
        />
      );
    default:
      return (
        <FileEdit
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
  }
}

function StatusBadge({
  status,
}: {
  status: ResponseRow['status'];
}): React.ReactElement {
  const label =
    {
      draft: 'borrador',
      pending_approval: 'pendiente aprobación',
      approved: 'aprobada',
      published: 'publicada',
      rejected: 'rechazada',
    }[status] ?? status;
  const tone =
    {
      draft: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
      pending_approval: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      approved: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
      published: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
    }[status] ?? 'bg-zinc-500/15';
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        tone,
      )}
    >
      {label}
    </span>
  );
}
