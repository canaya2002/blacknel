import 'server-only';

import { eq } from 'drizzle-orm';

import type { Session } from '@/lib/auth/types';
import { dbAs } from '@/lib/db/client';
import { organizations, plans } from '@/lib/db/schema';
import type { PlanCode } from '@/lib/plans/plans';

/**
 * Resolve the active plan code for the current session's organization.
 *
 * Reads `organizations.plan_id` → `plans.code`. Falls back to
 * `'standard'` when no plan is linked yet (orgs created before a plan
 * was attached during onboarding) so the UI never crashes on a missing
 * plan — it just gates everything as if the user were on the entry tier.
 */
export async function getOrgPlanCode(session: Session): Promise<PlanCode> {
  const rows = await dbAs<Array<{ code: PlanCode | null }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ code: plans.code })
        .from(organizations)
        .leftJoin(plans, eq(organizations.planId, plans.id))
        .where(eq(organizations.id, session.orgId))
        .limit(1),
  );

  return rows[0]?.code ?? 'standard';
}
