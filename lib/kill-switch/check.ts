import { env } from '@/lib/env';

/**
 * Phase 11 / Commit 40 — kill switch state + bypass list.
 *
 * Three states (see `BLACKNEL_KILL_SWITCH` doc in `lib/env.ts`):
 *
 *   - `false`     — app serves normally.
 *   - `read-only` — GET/HEAD pass; POST/PUT/PATCH/DELETE return 503.
 *   - `true`      — all routes return 503.
 *
 * # Bypass list
 *
 * Even when the switch is fully on, these paths must respond so
 * external monitors (Vercel, UptimeRobot) and the maintenance
 * page itself stay reachable:
 *
 *   - `/api/health`
 *   - `/maintenance`
 *   - `/_next/...` (static assets, framework chunks)
 *   - `/favicon.ico`
 *   - `/api/admin/kill-switch-status` (master-org operator endpoint)
 *   - `/api/meta/data-deletion` (legal/compliance — Meta polls this
 *     out-of-band; a 503 during maintenance would fail App Review and
 *     silently drop user deletion requests. Auth is at the signed_request
 *     layer, so bypassing the switch is safe.)
 *
 * # Procedure (solo-operator, pre-team)
 *
 * Before flipping `BLACKNEL_KILL_SWITCH`, the operator MUST commit
 * an incident draft at `doc/post-mortems/incident-YYYYMMDD-HHMM.md`
 * (template at `doc/post-mortems/_template.md`). The commit
 * message must start with `incident-open:` so audit trail is
 * grep-able. The runbook
 * (`doc/runbooks/kill-switch.md`) is the source of truth on this
 * procedure.
 */

export type KillSwitchState = 'false' | 'read-only' | 'true';

const BYPASS_PREFIXES = [
  '/api/health',
  '/maintenance',
  '/_next/',
  '/favicon.ico',
  '/api/admin/kill-switch-status',
  // Legal/compliance: Meta's data-deletion callback must respond even during
  // a maintenance window. Auth is at the signed_request (HMAC) layer.
  '/api/meta/data-deletion',
];

export function getKillSwitchState(): KillSwitchState {
  return env.BLACKNEL_KILL_SWITCH;
}

export function isPathBypassed(pathname: string): boolean {
  return BYPASS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Returns `true` if the request should be blocked given the
 * current kill-switch state. Pure: state + path + method in,
 * boolean out.
 */
export function shouldBlock(opts: {
  state: KillSwitchState;
  pathname: string;
  method: string;
}): boolean {
  if (opts.state === 'false') return false;
  if (isPathBypassed(opts.pathname)) return false;
  if (opts.state === 'true') return true;
  // read-only: only block mutating methods.
  return MUTATING_METHODS.has(opts.method.toUpperCase());
}
