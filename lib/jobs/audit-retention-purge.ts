import 'server-only';

import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import { resolveRetentionPolicy } from '@/lib/audit-advanced/retention';
import { type AnyPgTx, dbAdmin } from '@/lib/db/client';
import {
  auditEvents,
  auditRetentionPolicies,
  organizations,
  type AuditEvent,
  type AuditRetentionPolicy,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { ok, type Result } from '@/lib/types/result';

/**
 * Audit retention purge tick (Phase 10 / Commit 37).
 *
 * Daily cadence. For each org:
 *   1. Pull all `audit_retention_policies` rows.
 *   2. Scan a manageable chunk of events older than the LONGEST
 *      retention configured (lower bound). Resolve per-event
 *      retention via `resolveRetentionPolicy` precedence rule.
 *   3. Delete events whose actual age exceeds the resolved
 *      `retentionDays`.
 *   4. Emit `audit.retention.purged` summary audit event per
 *      org with `{rowsDeleted, oldestDate, policiesApplied}`
 *      (audit-of-audit).
 *
 * Orgs without policies are skipped — never purge data that
 * wasn't explicitly opted-in.
 */

export interface AuditRetentionPurgeTickDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: AuditRetentionPurgeTickDeps = {
  asAdmin: (fn) => dbAdmin(fn),
};

export interface AuditRetentionPurgeTickResult {
  readonly orgsConsidered: number;
  readonly orgsWithPolicies: number;
  readonly totalRowsDeleted: number;
}

const MAX_DELETE_PER_TICK = 5000;

export async function runAuditRetentionPurgeTick(input?: {
  now?: Date;
  deps?: AuditRetentionPurgeTickDeps;
}): Promise<Result<AuditRetentionPurgeTickResult>> {
  const now = input?.now ?? new Date();
  const deps = input?.deps ?? defaultDeps;

  const orgs: Array<{ id: string }> = await deps.asAdmin((tx) =>
    tx.select({ id: organizations.id }).from(organizations),
  );

  let orgsWithPolicies = 0;
  let totalRowsDeleted = 0;

  for (const o of orgs) {
    const policies: AuditRetentionPolicy[] = await deps.asAdmin((tx) =>
      tx
        .select()
        .from(auditRetentionPolicies)
        .where(eq(auditRetentionPolicies.organizationId, o.id)),
    );
    if (policies.length === 0) continue;
    orgsWithPolicies += 1;

    // Lower bound for "could possibly need purge" = oldest threshold
    // among ALL policies. Anything younger CANNOT be purged by any
    // policy.
    const shortestDays = Math.min(...policies.map((p) => p.retentionDays));
    const earliestPotentialPurgeCutoff = new Date(
      now.getTime() - shortestDays * 86_400_000,
    );

    // Pull a bounded chunk of candidate events older than the
    // shortest retention.
    const candidates: AuditEvent[] = await deps.asAdmin((tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, o.id),
            lt(auditEvents.createdAt, earliestPotentialPurgeCutoff),
          ),
        )
        .limit(MAX_DELETE_PER_TICK),
    );
    if (candidates.length === 0) continue;

    // For each candidate, resolve which policy applies; delete iff
    // its age > policy.retentionDays.
    const toDelete: string[] = [];
    let oldestDeleted: Date | null = null;
    for (const e of candidates) {
      const policy = resolveRetentionPolicy(e.action, policies);
      if (!policy) continue;
      const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
      if (e.createdAt < cutoff) {
        toDelete.push(e.id);
        if (!oldestDeleted || e.createdAt < oldestDeleted) {
          oldestDeleted = e.createdAt;
        }
      }
    }
    if (toDelete.length === 0) continue;

    await deps.asAdmin((tx) =>
      tx.delete(auditEvents).where(inArray(auditEvents.id, toDelete)),
    );
    totalRowsDeleted += toDelete.length;

    // Audit-of-audit: record the purge itself.
    await deps.asAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: o.id,
        userId: null,
        actorType: 'system',
        action: 'audit.retention.purged',
        entityType: 'audit_events',
        entityId: null,
        after: {
          rowsDeleted: toDelete.length,
          oldestDate: oldestDeleted?.toISOString() ?? null,
          policiesApplied: policies.map((p) => ({
            id: p.id,
            appliesTo: p.appliesTo,
            retentionDays: p.retentionDays,
          })),
        },
        riskLevel: 'low',
      }),
    );
  }

  log.info(
    {
      orgsConsidered: orgs.length,
      orgsWithPolicies,
      totalRowsDeleted,
    },
    'audit.retention.purge.tick',
  );

  void sql; // keep import live for future use

  return ok({
    orgsConsidered: orgs.length,
    orgsWithPolicies,
    totalRowsDeleted,
  });
}

export async function runAuditRetentionPurgeTickEntry(): Promise<
  Result<AuditRetentionPurgeTickResult>
> {
  return runAuditRetentionPurgeTick();
}
