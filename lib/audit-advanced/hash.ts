import { createHash } from 'node:crypto';

/**
 * Phase 10 / Commit 37, D-37-2 (a) — per-row tamper-detection
 * hash for `audit_events`.
 *
 * Hash inputs include every field meaningful for tamper detection:
 *
 *   - org_id
 *   - user_id
 *   - action
 *   - entity_type / entity_id
 *   - before (JSON-stringified, key-sorted)
 *   - after  (JSON-stringified, key-sorted)
 *   - created_at (ISO)
 *
 * NOT chained — each row carries an independent SHA-256 digest of
 * its own content. A row whose `event_hash` doesn't match the
 * recomputed hash is evidence of tampering. Phase 11 candidate:
 * full hash-chain for serial tamper detection across rows.
 */

export interface AuditHashInput {
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly action: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: Date;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

export function computeEventHash(input: AuditHashInput): string {
  const body = stableStringify({
    org: input.organizationId,
    user: input.userId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: input.before,
    after: input.after,
    createdAt: input.createdAt.toISOString(),
  });
  return createHash('sha256').update(body).digest('hex');
}

/**
 * Verifies a row's hash matches a recomputed one. Returns `true`
 * when the row passes (or when the row was inserted pre-C37 and
 * has a NULL `event_hash` — those rows are excluded from tamper
 * detection).
 */
export function verifyEventHash(
  storedHash: string | null,
  input: AuditHashInput,
): boolean {
  if (storedHash === null) return true; // pre-C37 row, exempt
  return storedHash === computeEventHash(input);
}
