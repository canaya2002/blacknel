import 'server-only';

import type { AuditRetentionPolicy } from '@/lib/db/schema';

/**
 * Phase 10 / Commit 37 — retention policy resolution (Ajuste 2).
 *
 * # Precedence rule (deterministic — documented + tested)
 *
 * Given multiple `audit_retention_policies` rows for an org that
 * could apply to a given audit `action`, pick ONE:
 *
 *   1. **Exact match wins** over prefix and `'all'`.
 *      `billing.charge` policy beats `billing.*` beats `all`.
 *   2. **Longer prefix wins** over shorter when both match.
 *      `billing.charge.*` beats `billing.*` for `billing.charge.refund`.
 *   3. **Longer retention wins on ties** (defense in depth —
 *      compliance prefers keeping data too long over too short).
 *
 * Returns `null` when no policy applies (caller treats as
 * "never purge").
 */
export function resolveRetentionPolicy(
  action: string,
  policies: ReadonlyArray<AuditRetentionPolicy>,
): AuditRetentionPolicy | null {
  if (policies.length === 0) return null;

  let best: AuditRetentionPolicy | null = null;
  let bestSpecificity = -1;

  for (const p of policies) {
    const spec = matchSpecificity(action, p.appliesTo);
    if (spec < 0) continue;
    if (spec > bestSpecificity) {
      best = p;
      bestSpecificity = spec;
    } else if (spec === bestSpecificity && best) {
      // Tie on specificity — longer retention wins.
      if (p.retentionDays > best.retentionDays) {
        best = p;
      }
    }
  }
  return best;
}

/**
 * Specificity score:
 *   - exact match → 1000 + length (favors longer exact strings if both match)
 *   - prefix match (`'x.y.*'`) → 100 + prefix length
 *   - `'all'` catch-all → 0
 *   - no match → -1
 */
function matchSpecificity(action: string, pattern: string): number {
  if (pattern === 'all') return 0;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    if (action === prefix || action.startsWith(`${prefix}.`)) {
      return 100 + prefix.length;
    }
    return -1;
  }
  if (action === pattern) return 1000 + pattern.length;
  return -1;
}
