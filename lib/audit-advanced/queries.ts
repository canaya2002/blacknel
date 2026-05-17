import 'server-only';

import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  auditAnomalies,
  auditEvents,
  auditRetentionPolicies,
  users,
  type AuditAnomaly,
  type AuditEvent,
  type AuditRetentionPolicy,
} from '@/lib/db/schema';

/**
 * Read layer for the Advanced Audit surface (Phase 10 / Commit 37).
 */

// ---------------------------------------------------------------------------
// Filtered audit search
// ---------------------------------------------------------------------------

export interface AuditFilterInput {
  readonly sinceDays: number;
  readonly actionPrefix?: string | null;
  readonly userId?: string | null;
  readonly entityType?: string | null;
}

export interface AuditRow {
  readonly id: string;
  readonly action: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly userId: string | null;
  readonly actorEmail: string | null;
  readonly actorName: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly riskLevel: string | null;
  readonly createdAt: Date;
}

export async function searchAuditEventsWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: AuditFilterInput,
  limit = 200,
): Promise<AuditRow[]> {
  const since = new Date(Date.now() - filters.sinceDays * 86_400_000);
  const conds = [
    eq(auditEvents.organizationId, orgId),
    gte(auditEvents.createdAt, since),
  ];
  if (filters.userId) {
    conds.push(eq(auditEvents.userId, filters.userId));
  }
  if (filters.entityType) {
    conds.push(eq(auditEvents.entityType, filters.entityType));
  }
  if (filters.actionPrefix && filters.actionPrefix.length > 0) {
    // Exact match OR prefix (`action LIKE 'billing.%'`).
    const trimmed = filters.actionPrefix.endsWith('.*')
      ? filters.actionPrefix.slice(0, -1) + '%'
      : `${filters.actionPrefix}%`;
    conds.push(sql`${auditEvents.action} LIKE ${trimmed}`);
  }
  const rows: Array<{
    event: AuditEvent;
    email: string | null;
    name: string | null;
  }> = await tx
    .select({
      event: auditEvents,
      email: users.email,
      name: users.name,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.userId))
    .where(and(...conds))
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.event.id,
    action: r.event.action,
    entityType: r.event.entityType,
    entityId: r.event.entityId,
    userId: r.event.userId,
    actorEmail: r.email,
    actorName: r.name,
    before: r.event.before,
    after: r.event.after,
    riskLevel: r.event.riskLevel,
    createdAt: r.event.createdAt,
  }));
}

/**
 * COUNT before stream (Ajuste 3) — returns the number of rows the
 * export would produce given filters. Caller blocks if >100K.
 */
export async function countAuditEventsWithTx(
  tx: AnyPgTx,
  orgId: string,
  filters: AuditFilterInput,
): Promise<number> {
  const since = new Date(Date.now() - filters.sinceDays * 86_400_000);
  const conds = [
    eq(auditEvents.organizationId, orgId),
    gte(auditEvents.createdAt, since),
  ];
  if (filters.userId) {
    conds.push(eq(auditEvents.userId, filters.userId));
  }
  if (filters.entityType) {
    conds.push(eq(auditEvents.entityType, filters.entityType));
  }
  if (filters.actionPrefix && filters.actionPrefix.length > 0) {
    const trimmed = filters.actionPrefix.endsWith('.*')
      ? filters.actionPrefix.slice(0, -1) + '%'
      : `${filters.actionPrefix}%`;
    conds.push(sql`${auditEvents.action} LIKE ${trimmed}`);
  }
  const rows: Array<{ count: number }> = await tx
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(auditEvents)
    .where(and(...conds));
  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Anomalies feed
// ---------------------------------------------------------------------------

export interface AnomalyRow {
  readonly id: string;
  readonly kind: AuditAnomaly['kind'];
  readonly status: AuditAnomaly['status'];
  readonly userId: string | null;
  readonly userEmail: string | null;
  readonly evidence: Record<string, unknown>;
  readonly decidedAt: Date | null;
  readonly decidedReason: string | null;
  readonly createdAt: Date;
}

export async function listAnomaliesWithTx(
  tx: AnyPgTx,
  orgId: string,
  opts: { status?: AuditAnomaly['status'] | 'all'; limit?: number } = {},
): Promise<AnomalyRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const conds = [eq(auditAnomalies.organizationId, orgId)];
  if (opts.status && opts.status !== 'all') {
    conds.push(eq(auditAnomalies.status, opts.status));
  }
  const rows: Array<{
    anomaly: AuditAnomaly;
    email: string | null;
  }> = await tx
    .select({
      anomaly: auditAnomalies,
      email: users.email,
    })
    .from(auditAnomalies)
    .leftJoin(users, eq(users.id, auditAnomalies.userId))
    .where(and(...conds))
    .orderBy(desc(auditAnomalies.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.anomaly.id,
    kind: r.anomaly.kind,
    status: r.anomaly.status,
    userId: r.anomaly.userId,
    userEmail: r.email,
    evidence: (r.anomaly.evidence as Record<string, unknown>) ?? {},
    decidedAt: r.anomaly.decidedAt,
    decidedReason: r.anomaly.decidedReason,
    createdAt: r.anomaly.createdAt,
  }));
}

export async function listAnomalies(ctx: {
  orgId: string;
  userId: string;
  status?: AuditAnomaly['status'] | 'all';
  limit?: number;
}): Promise<AnomalyRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listAnomaliesWithTx(tx, ctx.orgId, {
      status: ctx.status ?? 'pending',
      limit: ctx.limit ?? 100,
    }),
  );
}

// ---------------------------------------------------------------------------
// Retention policies
// ---------------------------------------------------------------------------

export async function listRetentionPoliciesWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<AuditRetentionPolicy[]> {
  return tx
    .select()
    .from(auditRetentionPolicies)
    .where(eq(auditRetentionPolicies.organizationId, orgId))
    .orderBy(desc(auditRetentionPolicies.createdAt));
}

export async function listRetentionPolicies(ctx: {
  orgId: string;
  userId: string;
}): Promise<AuditRetentionPolicy[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listRetentionPoliciesWithTx(tx, ctx.orgId),
  );
}

// ---------------------------------------------------------------------------
// Per-actor timeline (D-37-5 b — all events with userId)
// ---------------------------------------------------------------------------

export async function loadUserTimelineWithTx(
  tx: AnyPgTx,
  orgId: string,
  userId: string,
  sinceDays = 30,
  limit = 200,
): Promise<AuditRow[]> {
  return searchAuditEventsWithTx(
    tx,
    orgId,
    { sinceDays, userId },
    limit,
  );
}

/**
 * Helper for retention purge cron — returns the events
 * older than the policy threshold for a given action.
 */
export async function findExpiredEventsWithTx(
  tx: AnyPgTx,
  orgId: string,
  cutoff: Date,
  actionPrefix: string,
): Promise<AuditEvent[]> {
  const conds = [
    eq(auditEvents.organizationId, orgId),
    lt(auditEvents.createdAt, cutoff),
  ];
  if (actionPrefix !== 'all') {
    const pattern = actionPrefix.endsWith('.*')
      ? actionPrefix.slice(0, -1) + '%'
      : actionPrefix;
    if (pattern.includes('%')) {
      conds.push(sql`${auditEvents.action} LIKE ${pattern}`);
    } else {
      conds.push(eq(auditEvents.action, pattern));
    }
  }
  return tx
    .select()
    .from(auditEvents)
    .where(and(...conds));
}
