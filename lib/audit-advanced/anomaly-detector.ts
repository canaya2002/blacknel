import 'server-only';

import type { AuditAnomalyKind, AuditEvent } from '@/lib/db/schema';

/**
 * Phase 10 / Commit 37 — heuristic anomaly detector (D-37-1 a,
 * conservative).
 *
 * Three kinds today, picked for low false-positive rate:
 *
 *   1. `off_hours_access` — ≥3 events from the same user inside
 *      a 1-hour window between 22:00 and 06:00 UTC.
 *   2. `new_ip` — a user's audit event carrying an IP that has
 *      not appeared in their prior 90-day history.
 *   3. `mass_export` — a single `reports.csv.exported` /
 *      `audit.exported` event whose `after.rowCount > 1000`
 *      (matches the critical-action threshold).
 *
 * Pure functions over caller-supplied data. The cron tick
 * (`lib/jobs/audit-anomaly-scan.ts`) loads the recent event
 * window + the per-user IP history and feeds them in.
 */

export interface DetectedAnomaly {
  readonly kind: AuditAnomalyKind;
  readonly userId: string | null;
  readonly evidence: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// off_hours_access
// ---------------------------------------------------------------------------

const OFF_HOURS_START = 22; // 22:00 UTC
const OFF_HOURS_END = 6; // 06:00 UTC

function isOffHours(d: Date): boolean {
  const h = d.getUTCHours();
  return h >= OFF_HOURS_START || h < OFF_HOURS_END;
}

export function detectOffHoursAccess(
  events: ReadonlyArray<AuditEvent>,
  threshold = 3,
): DetectedAnomaly[] {
  const byUser = new Map<string, AuditEvent[]>();
  for (const e of events) {
    if (!e.userId) continue;
    if (!isOffHours(e.createdAt)) continue;
    const list = byUser.get(e.userId) ?? [];
    list.push(e);
    byUser.set(e.userId, list);
  }
  const out: DetectedAnomaly[] = [];
  for (const [userId, list] of byUser.entries()) {
    if (list.length < threshold) continue;
    out.push({
      kind: 'off_hours_access',
      userId,
      evidence: {
        events: list.slice(0, 10).map((e) => ({
          id: e.id,
          action: e.action,
          hour: e.createdAt.getUTCHours(),
        })),
        threshold,
        total: list.length,
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// new_ip
// ---------------------------------------------------------------------------

export interface UserIpHistory {
  readonly userId: string;
  readonly priorIps: ReadonlyArray<string>;
}

export function detectNewIp(
  events: ReadonlyArray<AuditEvent>,
  history: ReadonlyArray<UserIpHistory>,
): DetectedAnomaly[] {
  const ipByUser = new Map<string, Set<string>>();
  for (const h of history) {
    ipByUser.set(h.userId, new Set<string>(h.priorIps));
  }
  const out: DetectedAnomaly[] = [];
  const seenAnomalies = new Set<string>(); // dedup per (user, ip)
  for (const e of events) {
    if (!e.userId || !e.ip) continue;
    const prior = ipByUser.get(e.userId);
    if (!prior || prior.has(e.ip)) continue;
    const key = `${e.userId}:${e.ip}`;
    if (seenAnomalies.has(key)) continue;
    seenAnomalies.add(key);
    out.push({
      kind: 'new_ip',
      userId: e.userId,
      evidence: {
        ip: e.ip,
        first_seen_at: e.createdAt.toISOString(),
        prior_ips: [...prior].slice(0, 10),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// mass_export
// ---------------------------------------------------------------------------

const MASS_EXPORT_THRESHOLD = 1000;

const MASS_EXPORT_ACTIONS = new Set([
  'reports.csv.exported',
  'audit.exported',
]);

export function detectMassExport(
  events: ReadonlyArray<AuditEvent>,
  threshold = MASS_EXPORT_THRESHOLD,
): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = [];
  for (const e of events) {
    if (!MASS_EXPORT_ACTIONS.has(e.action)) continue;
    const after = (e.after as Record<string, unknown> | null) ?? {};
    const rowCount =
      typeof after.rowCount === 'number'
        ? after.rowCount
        : typeof after.row_count === 'number'
          ? after.row_count
          : 0;
    if (rowCount <= threshold) continue;
    out.push({
      kind: 'mass_export',
      userId: e.userId,
      evidence: {
        event_id: e.id,
        action: e.action,
        rows: rowCount,
        threshold,
      },
    });
  }
  return out;
}
