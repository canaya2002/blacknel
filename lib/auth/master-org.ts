import 'server-only';

import { env } from '@/lib/env';
import { AppError } from '@/lib/errors';

import type { Session } from './types';

/**
 * Phase 11 / Commit 40 — master org guard.
 *
 * The Blacknel-internal master org is identified by
 * `BLACKNEL_MASTER_ORG_ID`. Its owner sees `/admin/*` — cost
 * dashboard, kill switch admin (future), post-mortem index
 * (future). NO other roles, NO other orgs.
 *
 * Why a separate org rather than a `superadmin` role flag on
 * `users`: keeps the permission model multi-tenant-pure. The
 * master org is just another row; what makes it special is the
 * env var pointing at its UUID. Rotating "master ops" team =
 * change the env var, not touch user records.
 */

export function isMasterOrg(orgId: string): boolean {
  return orgId === env.BLACKNEL_MASTER_ORG_ID;
}

export function isMasterOrgOwner(session: Session): boolean {
  return isMasterOrg(session.orgId) && session.role === 'owner';
}

/**
 * Hard guard for `/admin/*` Route Handlers and layouts. Throws
 * `FORBIDDEN` (HTTP 403) when the session doesn't meet the bar.
 */
export function requireMasterOrgOwner(session: Session): void {
  if (!isMasterOrgOwner(session)) {
    throw new AppError(
      'FORBIDDEN',
      'Master-org owner privileges required.',
      { meta: { orgId: session.orgId, role: session.role } },
    );
  }
}
