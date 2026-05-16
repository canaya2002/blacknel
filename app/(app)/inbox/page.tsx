import { PageHeader } from '@/components/common/page-header';
import {
  EmptyInboxNarrowSlice,
  EmptyInboxNoMatches,
  EmptyInboxNoThreads,
} from '@/components/inbox/empty-states';
import { FiltersBar } from '@/components/inbox/filters-bar';
import { InboxListPolling } from '@/components/inbox/inbox-polling';
import { ThreadList } from '@/components/inbox/thread-list';
import { requireUser } from '@/lib/auth/server';
import { decodeThreadCursor } from '@/lib/inbox/cursor';
import { hasActiveFilters, parseInboxFilters } from '@/lib/inbox/filters';
import { listThreads, orgHasAnyThreads } from '@/lib/inbox/queries';
import { authorize } from '@/lib/permissions/can';

export const dynamic = 'force-dynamic';

interface InboxPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function InboxPage({
  searchParams,
}: InboxPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'inbox:read');

  const sp = await searchParams;
  const { filters, cursor: rawCursor } = parseInboxFilters(sp);
  const cursor = decodeThreadCursor(rawCursor ?? null);

  const [page, hasAny] = await Promise.all([
    listThreads({
      orgId: session.orgId,
      userId: session.userId,
      filters,
      cursor,
    }),
    orgHasAnyThreads({ orgId: session.orgId, userId: session.userId }),
  ]);

  const active = hasActiveFilters(filters);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <InboxListPolling />
      <PageHeader
        title="Inbox"
        description="Mensajes directos, comentarios y menciones de todas tus redes en una sola bandeja. Asigna, responde con IA con guardrails, cierra cuando esté resuelto."
      />

      <FiltersBar filters={filters} />

      <div className="flex-1 overflow-hidden">
        {page.threads.length > 0 ? (
          <ThreadList
            initialThreads={page.threads}
            initialNextCursor={page.nextCursor}
            filters={filters}
          />
        ) : !hasAny ? (
          <EmptyInboxNoThreads />
        ) : active ? (
          isNarrowSlice(filters) ? (
            <EmptyInboxNarrowSlice scopeLabel={narrowSliceLabel(filters)} />
          ) : (
            <EmptyInboxNoMatches />
          )
        ) : (
          // Org has threads, no filters, yet zero results — only
          // possible during pagination beyond the last page, which we
          // bounce back to a plain empty list.
          <EmptyInboxNoMatches />
        )}
      </div>
    </div>
  );
}

/**
 * Heuristic for the "narrow slice" empty-state branch: the user filtered
 * down to a less-common status (`closed`, `spam`, `snoozed`) without
 * other relaxations. Anything else is "no matches" generic.
 */
function isNarrowSlice(filters: { status?: ReadonlyArray<string> }): boolean {
  if (!filters.status || filters.status.length === 0) return false;
  const narrowOnly = filters.status.every((s) =>
    s === 'closed' || s === 'spam' || s === 'snoozed',
  );
  return narrowOnly;
}

function narrowSliceLabel(filters: { status?: ReadonlyArray<string> }): string {
  if (!filters.status?.length) return 'en esa selección';
  if (filters.status.length === 1) {
    const label = {
      closed: 'cerrados',
      spam: 'marcados como spam',
      snoozed: 'posponidos',
    }[filters.status[0]!] ?? 'en ese estado';
    return label;
  }
  return 'en esos estados';
}
