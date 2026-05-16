'use server';

import { requireUser } from '@/lib/auth/server';
import { decodeThreadCursor } from '@/lib/inbox/cursor';
import type { InboxFilters } from '@/lib/inbox/filters';
import { listThreads, type ThreadListPage } from '@/lib/inbox/queries';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Load-more pagination for /inbox. Lives in its own module so the
 * client `<ThreadList>` can import a single Server Action without
 * dragging in the rest of `actions.ts` (and its dependencies).
 *
 * Input is the next-page cursor plus the same filters the page is
 * currently showing. We validate auth + RBAC + cursor + filters before
 * touching the DB.
 */
export async function loadMoreThreadsAction(input: {
  cursor: string;
  filters: InboxFilters;
}): Promise<Result<ThreadListPage>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:read');

  const cursor = decodeThreadCursor(input.cursor);
  if (!cursor) {
    return err('VALIDATION_ERROR', 'Cursor inválido.');
  }

  const page = await listThreads({
    orgId: session.orgId,
    userId: session.userId,
    filters: input.filters,
    cursor,
  });
  return ok(page);
}
