'use client';

import { Mail } from 'lucide-react';
import { useTransition } from 'react';

import { cancelReviewRequestAction } from '@/app/(app)/reviews/requests/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';
import type { RequestListItem } from '@/lib/reviews/request-queries';

interface RequestsListProps {
  items: ReadonlyArray<RequestListItem>;
}

const OUTCOME_TONE: Record<NonNullable<RequestListItem['outcome']>, string> = {
  positive_routed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  negative_captured: 'bg-red-500/15 text-red-700 dark:text-red-300',
  no_response: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  expired: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

const OUTCOME_LABEL: Record<NonNullable<RequestListItem['outcome']>, string> = {
  positive_routed: 'positiva',
  negative_captured: 'capturada',
  no_response: 'sin respuesta',
  expired: 'expirada',
};

export function RequestsList({ items }: RequestsListProps): React.ReactElement {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-card/30 px-4 py-10 text-center text-xs text-muted-foreground">
        Aún no se han enviado solicitudes en este período. Crea la primera con
        el botón &ldquo;Nueva solicitud&rdquo; arriba.
      </div>
    );
  }
  return (
    <ul className="divide-y rounded-md border" data-testid="requests-list">
      {items.map((item) => (
        <RequestRow key={item.id} item={item} />
      ))}
    </ul>
  );
}

function RequestRow({ item }: { item: RequestListItem }): React.ReactElement {
  const [pending, startTransition] = useTransition();
  const cancel = (): void => {
    const fd = new FormData();
    fd.set('requestId', item.id);
    startTransition(async () => {
      await cancelReviewRequestAction(null, fd);
    });
  };

  const decided = Boolean(item.completedAt);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 text-xs">
      <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex-1 truncate font-medium">
        {item.contactEmail ?? '—'}
        {item.contactName ? (
          <span className="text-muted-foreground"> · {item.contactName}</span>
        ) : null}
      </span>
      <span className="hidden text-muted-foreground sm:inline">
        {item.brandName ?? '—'} · {item.locationName ?? '—'}
      </span>
      <span className="text-muted-foreground tabular-nums">
        {item.sentAt ? formatRelativeDays(item.sentAt) : '—'}
      </span>
      {item.outcome ? (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
            OUTCOME_TONE[item.outcome],
          )}
        >
          {OUTCOME_LABEL[item.outcome]}
        </span>
      ) : (
        <Badge variant="muted" className="text-[10px] uppercase">
          {item.openedAt ? 'Abierta' : 'Enviada'}
        </Badge>
      )}
      {!decided ? (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px]"
          onClick={cancel}
          disabled={pending}
        >
          Cancelar
        </Button>
      ) : null}
    </li>
  );
}

function formatRelativeDays(d: Date): string {
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days}d`;
  if (days < 365) return `hace ${Math.round(days / 30)}m`;
  return `hace ${Math.round(days / 365)}a`;
}
