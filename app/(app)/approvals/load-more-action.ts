'use server';

import { requireUser } from '@/lib/auth/server';
import { decodeApprovalCursor } from '@/lib/approvals/cursor';
import type { ApprovalFilters } from '@/lib/approvals/filters';
import { listApprovals, type ApprovalListPage } from '@/lib/approvals/queries';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

export async function loadMoreApprovalsAction(input: {
  cursor: string;
  filters: ApprovalFilters;
}): Promise<Result<ApprovalListPage>> {
  const session = await requireUser();
  authorize(session.role, 'approvals:read');

  const cursor = decodeApprovalCursor(input.cursor);
  if (!cursor) {
    return err('VALIDATION_ERROR', 'Cursor inválido.');
  }

  const page = await listApprovals({
    orgId: session.orgId,
    userId: session.userId,
    filters: input.filters,
    cursor,
  });
  return ok(page);
}
