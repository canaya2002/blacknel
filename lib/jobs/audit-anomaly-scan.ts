import 'server-only';

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import {
  detectMassExport,
  detectNewIp,
  detectOffHoursAccess,
  type DetectedAnomaly,
  type UserIpHistory,
} from '@/lib/audit-advanced/anomaly-detector';
import { type AnyPgTx, dbAdmin } from '@/lib/db/client';
import {
  auditAnomalies,
  auditEvents,
  organizations,
  type AuditEvent,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { ok, type Result } from '@/lib/types/result';

/**
 * Audit anomaly scan tick (Phase 10 / Commit 37).
 *
 * Hour-cadence. For each org:
 *   1. Pull last 1h audit_events.
 *   2. Pull 90d per-user IP history.
 *   3. Run all three detectors.
 *   4. Persist new anomalies with status='pending'. Dedup via
 *      content-hash of evidence so same heuristic doesn't generate
 *      duplicates on overlapping windows.
 */

export interface AuditAnomalyTickDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: AuditAnomalyTickDeps = {
  asAdmin: (fn) => dbAdmin(fn),
};

export interface AuditAnomalyTickResult {
  readonly orgsConsidered: number;
  readonly anomaliesDetected: number;
  readonly anomaliesPersisted: number;
}

const WINDOW_MS = 60 * 60_000;
const HISTORY_MS = 90 * 86_400_000;

export async function runAuditAnomalyScanTick(input?: {
  now?: Date;
  deps?: AuditAnomalyTickDeps;
}): Promise<Result<AuditAnomalyTickResult>> {
  const now = input?.now ?? new Date();
  const deps = input?.deps ?? defaultDeps;
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const historyStart = new Date(now.getTime() - HISTORY_MS);

  const orgs: Array<{ id: string }> = await deps.asAdmin((tx) =>
    tx.select({ id: organizations.id }).from(organizations),
  );

  let anomaliesDetected = 0;
  let anomaliesPersisted = 0;

  for (const o of orgs) {
    const events: AuditEvent[] = await deps.asAdmin((tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.organizationId, o.id),
            gte(auditEvents.createdAt, windowStart),
          ),
        ),
    );
    if (events.length === 0) continue;

    // 90d per-user IP history — STRICTLY BEFORE the current
    // window so the current event's IP doesn't appear as
    // already-known.
    const historyRows: Array<{ userId: string; ip: string }> =
      await deps.asAdmin((tx) =>
        tx
          .select({
            userId: auditEvents.userId,
            ip: auditEvents.ip,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.organizationId, o.id),
              gte(auditEvents.createdAt, historyStart),
              lt(auditEvents.createdAt, windowStart),
              sql`${auditEvents.userId} IS NOT NULL`,
              sql`${auditEvents.ip} IS NOT NULL`,
            ),
          ),
      );
    const ipsByUser = new Map<string, Set<string>>();
    for (const h of historyRows) {
      if (!h.userId || !h.ip) continue;
      const s = ipsByUser.get(h.userId) ?? new Set<string>();
      s.add(h.ip);
      ipsByUser.set(h.userId, s);
    }
    const history: UserIpHistory[] = [];
    for (const [userId, ips] of ipsByUser.entries()) {
      history.push({ userId, priorIps: [...ips] });
    }

    const detected: DetectedAnomaly[] = [
      ...detectOffHoursAccess(events),
      ...detectNewIp(events, history),
      ...detectMassExport(events),
    ];
    anomaliesDetected += detected.length;

    for (const d of detected) {
      // Dedup: an org + kind + userId combo already pending shouldn't
      // generate a duplicate row this hour.
      const existing: Array<{ id: string }> = await deps.asAdmin((tx) =>
        tx
          .select({ id: auditAnomalies.id })
          .from(auditAnomalies)
          .where(
            and(
              eq(auditAnomalies.organizationId, o.id),
              eq(auditAnomalies.kind, d.kind),
              eq(auditAnomalies.status, 'pending'),
              d.userId
                ? eq(auditAnomalies.userId, d.userId)
                : sql`${auditAnomalies.userId} IS NULL`,
            ),
          )
          .limit(1),
      );
      if (existing.length > 0) continue;
      try {
        await deps.asAdmin((tx) =>
          tx.insert(auditAnomalies).values({
            organizationId: o.id,
            kind: d.kind,
            ...(d.userId ? { userId: d.userId } : {}),
            evidence: d.evidence,
            status: 'pending',
          }),
        );
        anomaliesPersisted += 1;
      } catch (cause) {
        log.warn(
          {
            err: (cause as Error).message,
            orgId: o.id,
            kind: d.kind,
          },
          'audit.anomaly.persist.failed',
        );
      }
    }
  }

  log.info(
    {
      orgsConsidered: orgs.length,
      anomaliesDetected,
      anomaliesPersisted,
    },
    'audit.anomaly.tick',
  );
  return ok({
    orgsConsidered: orgs.length,
    anomaliesDetected,
    anomaliesPersisted,
  });
}

export async function runAuditAnomalyScanTickEntry(): Promise<
  Result<AuditAnomalyTickResult>
> {
  return runAuditAnomalyScanTick();
}
