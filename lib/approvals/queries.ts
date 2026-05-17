import 'server-only';

import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { type AnyPgTx, dbAs } from '../db/client';
import { approvals, reviewResponses, users } from '../db/schema';

import { encodeApprovalCursor, type ApprovalCursor } from './cursor';
import type { ApprovalFilters } from './filters';

/**
 * Read paths for /approvals.
 *
 * `listApprovals` mirrors the inbox pattern: cursor-based pagination,
 * filter predicates, and a `listApprovalsWithTx` test seam.
 *
 * `getApprovalDetail` returns the full approval row plus the names
 * of `requested_by` / `assigned_to` / `decided_by` so the diff view
 * can attribute the change.
 */

const DEFAULT_PAGE_SIZE = 50;

export interface ApprovalListItem {
  readonly id: string;
  readonly kind: 'inbox_reply' | 'review_response' | 'post' | 'crisis_response' | 'campaign';
  readonly entityTable: string;
  readonly entityId: string;
  readonly status: 'pending' | 'approved' | 'rejected' | 'edited_approved' | 'escalated' | 'expired';
  readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
  readonly aiRiskFlags: ReadonlyArray<string>;
  readonly requestedBy: string | null;
  readonly requestedByName: string | null;
  readonly assignedTo: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly proposedPreview: string | null;
}

export interface ApprovalListPage {
  readonly approvals: ReadonlyArray<ApprovalListItem>;
  readonly nextCursor: string | null;
}

export interface ListApprovalsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: ApprovalFilters;
  readonly cursor: ApprovalCursor | null;
  readonly pageSize?: number;
}

export async function listApprovals(opts: ListApprovalsOpts): Promise<ApprovalListPage> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) => listApprovalsWithTx(tx, opts),
  );
}

export async function listApprovalsWithTx(
  tx: AnyPgTx,
  opts: ListApprovalsOpts,
): Promise<ApprovalListPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const { orgId, userId, filters, cursor } = opts;

  const conditions: SQL[] = [eq(approvals.organizationId, orgId)];

  if (filters.status?.length) {
    conditions.push(
      inArray(approvals.status, filters.status as Array<typeof filters.status[number]>),
    );
  }
  if (filters.kind?.length) {
    conditions.push(
      inArray(approvals.kind, filters.kind as Array<typeof filters.kind[number]>),
    );
  }
  if (filters.riskLevel?.length) {
    conditions.push(
      inArray(
        approvals.riskLevel,
        filters.riskLevel as Array<typeof filters.riskLevel[number]>,
      ),
    );
  }
  if (filters.assignedTo === 'unassigned') {
    conditions.push(isNull(approvals.assignedTo));
  } else if (filters.assignedTo === 'me') {
    conditions.push(eq(approvals.assignedTo, userId));
  } else if (typeof filters.assignedTo === 'string') {
    conditions.push(eq(approvals.assignedTo, filters.assignedTo));
  }
  if (cursor) {
    conditions.push(
      sql`(${approvals.createdAt}, ${approvals.id}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`,
    );
  }

  type Row = {
    id: string;
    kind: ApprovalListItem['kind'];
    entityTable: string;
    entityId: string;
    status: ApprovalListItem['status'];
    riskLevel: ApprovalListItem['riskLevel'];
    aiRiskFlags: unknown;
    requestedBy: string | null;
    requestedByName: string | null;
    assignedTo: string | null;
    createdAt: Date;
    decidedAt: Date | null;
    proposedPreview: string | null;
  };

  const rows: Row[] = await tx
    .select({
      id: approvals.id,
      kind: approvals.kind,
      entityTable: approvals.entityTable,
      entityId: approvals.entityId,
      status: approvals.status,
      riskLevel: approvals.riskLevel,
      aiRiskFlags: approvals.aiRiskFlags,
      requestedBy: approvals.requestedBy,
      requestedByName: users.name,
      assignedTo: approvals.assignedTo,
      createdAt: approvals.createdAt,
      decidedAt: approvals.decidedAt,
      // Cheap text preview pulled from the proposed payload's
      // messageBody when it exists. Falls back to NULL when the kind
      // doesn't have a messageBody — the UI handles that gracefully.
      proposedPreview: sql<string | null>`(${approvals.proposedPayload}->>'messageBody')`.as(
        'proposed_preview',
      ),
    })
    .from(approvals)
    .leftJoin(users, eq(users.id, approvals.requestedBy))
    .where(and(...conditions))
    .orderBy(desc(approvals.createdAt), desc(approvals.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const visible = hasMore ? rows.slice(0, pageSize) : rows;
  const tail = visible[visible.length - 1];
  const nextCursor =
    hasMore && tail
      ? encodeApprovalCursor({
          t: tail.createdAt.toISOString(),
          i: tail.id,
        })
      : null;

  return {
    approvals: visible.map(
      (r): ApprovalListItem => ({
        id: r.id,
        kind: r.kind,
        entityTable: r.entityTable,
        entityId: r.entityId,
        status: r.status,
        riskLevel: r.riskLevel,
        aiRiskFlags: Array.isArray(r.aiRiskFlags) ? (r.aiRiskFlags as string[]) : [],
        requestedBy: r.requestedBy,
        requestedByName: r.requestedByName,
        assignedTo: r.assignedTo,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        proposedPreview: r.proposedPreview,
      }),
    ),
    nextCursor,
  };
}

export interface ApprovalDetail {
  readonly id: string;
  readonly kind: ApprovalListItem['kind'];
  readonly entityTable: string;
  readonly entityId: string;
  readonly status: ApprovalListItem['status'];
  readonly riskLevel: ApprovalListItem['riskLevel'];
  readonly aiRiskFlags: ReadonlyArray<string>;
  readonly requestedBy: string | null;
  readonly requestedByName: string | null;
  readonly assignedTo: string | null;
  readonly decidedBy: string | null;
  readonly decidedByName: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  readonly originalPayload: Record<string, unknown> | null;
  readonly proposedPayload: Record<string, unknown>;
}

export async function getApprovalDetail(opts: {
  orgId: string;
  userId: string;
  approvalId: string;
}): Promise<ApprovalDetail | null> {
  const requestedByUsers = alias(users, 'requested_by_users');
  const decidedByUsers = alias(users, 'decided_by_users');

  const rows = await dbAs<Array<ApprovalDetail>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({
          id: approvals.id,
          kind: approvals.kind,
          entityTable: approvals.entityTable,
          entityId: approvals.entityId,
          status: approvals.status,
          riskLevel: approvals.riskLevel,
          aiRiskFlags: approvals.aiRiskFlags,
          requestedBy: approvals.requestedBy,
          requestedByName: requestedByUsers.name,
          assignedTo: approvals.assignedTo,
          decidedBy: approvals.decidedBy,
          decidedByName: decidedByUsers.name,
          decisionReason: approvals.decisionReason,
          createdAt: approvals.createdAt,
          decidedAt: approvals.decidedAt,
          originalPayload: approvals.originalPayload,
          proposedPayload: approvals.proposedPayload,
        })
        .from(approvals)
        .leftJoin(requestedByUsers, eq(requestedByUsers.id, approvals.requestedBy))
        .leftJoin(decidedByUsers, eq(decidedByUsers.id, approvals.decidedBy))
        .where(
          and(
            eq(approvals.id, opts.approvalId),
            eq(approvals.organizationId, opts.orgId),
          ),
        )
        .limit(1) as unknown as Promise<ApprovalDetail[]>,
  );

  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    aiRiskFlags: Array.isArray(row.aiRiskFlags) ? (row.aiRiskFlags as string[]) : [],
    originalPayload:
      row.originalPayload && typeof row.originalPayload === 'object'
        ? (row.originalPayload as Record<string, unknown>)
        : null,
    proposedPayload:
      (row.proposedPayload && typeof row.proposedPayload === 'object'
        ? (row.proposedPayload as Record<string, unknown>)
        : {}) as Record<string, unknown>,
  };
}

/**
 * Return the count of pending approvals whose `proposed_payload.threadId`
 * matches the given thread. Drives the banner on the inbox detail page.
 */
export async function pendingApprovalsForThread(opts: {
  orgId: string;
  userId: string;
  threadId: string;
}): Promise<ReadonlyArray<{ id: string; createdAt: Date; riskLevel: string }>> {
  return dbAs<Array<{ id: string; createdAt: Date; riskLevel: string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({
          id: approvals.id,
          createdAt: approvals.createdAt,
          riskLevel: approvals.riskLevel,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.organizationId, opts.orgId),
            eq(approvals.kind, 'inbox_reply'),
            inArray(approvals.status, ['pending', 'escalated'] as const),
            sql`(${approvals.proposedPayload}->>'threadId') = ${opts.threadId}`,
          ),
        )
        .orderBy(desc(approvals.createdAt))
        .limit(5),
  );
}

/**
 * Return pending / escalated approvals tied to a given review. Drives
 * the bidirectional banner on /reviews/[reviewId]:
 *
 *   "Hay 1 respuesta pendiente de aprobación → /approvals/[id]"
 *
 * Matched via `proposed_payload.reviewId` (set by send-response.ts).
 * Falls back to a JOIN through `review_responses` for any legacy
 * approval rows without that payload field — both paths return the
 * same shape.
 */
export async function pendingApprovalsForReview(opts: {
  orgId: string;
  userId: string;
  reviewId: string;
}): Promise<ReadonlyArray<{ id: string; createdAt: Date; riskLevel: string }>> {
  return dbAs<Array<{ id: string; createdAt: Date; riskLevel: string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({
          id: approvals.id,
          createdAt: approvals.createdAt,
          riskLevel: approvals.riskLevel,
        })
        .from(approvals)
        .leftJoin(reviewResponses, eq(reviewResponses.id, approvals.entityId))
        .where(
          and(
            eq(approvals.organizationId, opts.orgId),
            eq(approvals.kind, 'review_response'),
            inArray(approvals.status, ['pending', 'escalated'] as const),
            sql`(
              (${approvals.proposedPayload}->>'reviewId') = ${opts.reviewId}
              OR ${reviewResponses.reviewId} = ${opts.reviewId}::uuid
            )`,
          ),
        )
        .orderBy(desc(approvals.createdAt))
        .limit(5),
  );
}

/**
 * Return the active (pending / escalated) approval row tied to a
 * post, if any. Drives the bidirectional banner on the composer:
 *
 *   "Este post está en aprobación → /approvals/[id]"
 *
 * Matched via `approvals.entity_table='posts' AND entity_id=postId`.
 * Returns at most one row — the schema doesn't enforce uniqueness
 * but `apply-schedule.ts` only ever inserts one approval per post.
 */
export async function pendingApprovalForPost(opts: {
  orgId: string;
  userId: string;
  postId: string;
}): Promise<{ id: string; createdAt: Date; riskLevel: string } | null> {
  const rows = await dbAs<Array<{ id: string; createdAt: Date; riskLevel: string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({
          id: approvals.id,
          createdAt: approvals.createdAt,
          riskLevel: approvals.riskLevel,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.organizationId, opts.orgId),
            eq(approvals.entityTable, 'posts'),
            eq(approvals.entityId, opts.postId),
            inArray(approvals.status, ['pending', 'escalated'] as const),
          ),
        )
        .orderBy(desc(approvals.createdAt))
        .limit(1),
  );
  return rows[0] ?? null;
}

