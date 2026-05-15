'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { organizations, plans, subscriptions } from '@/lib/db/schema';
import { authorize } from '@/lib/permissions/can';
import { PLAN_CODES, type PlanCode } from '@/lib/plans/plans';
import { getPlanLimit } from '@/lib/plans/limits';
import { readUsage } from '@/lib/usage/counters';
import { ok, type Result } from '@/lib/types/result';

/**
 * Plan switching, mocked end-to-end. We mutate `organizations.plan_id`
 * + `subscriptions.plan_id` directly — there's no Stripe Checkout, no
 * webhook, no proration. Phase 12 cuts this over to Stripe:
 *
 *   - Upgrade  → Stripe Checkout in `app/billing/checkout-action.ts`;
 *                webhook flips the rows on confirmation.
 *   - Downgrade → schedules a Stripe subscription update with
 *                proration_behavior='create_prorations'.
 *
 * Until then, the action accepts the new plan immediately *but* still
 * runs the downgrade-safety validation that Phase 12 must keep:
 *   - if moving to a plan with a lower cap on a metric the org already
 *     uses past, refuse and report the over-usage.
 */

const changePlanSchema = z.object({
  planCode: z.enum(PLAN_CODES as unknown as [PlanCode, ...PlanCode[]]),
});

const METRICS_TO_CHECK = ['brands', 'users', 'socialAccounts', 'locations'] as const;

export interface PlanChangeBlockedReason {
  metric: (typeof METRICS_TO_CHECK)[number];
  current: number;
  newCap: number;
}

export async function changePlanAction(
  _prev: unknown,
  formData: FormData,
): Promise<
  Result<{ planCode: PlanCode }, {
    code: 'PLAN_LIMIT_REACHED' | 'VALIDATION_ERROR' | 'FORBIDDEN';
    message: string;
    blockers?: PlanChangeBlockedReason[];
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'billing:manage');

  const parsed = changePlanSchema.safeParse({ planCode: formData.get('planCode') });
  if (!parsed.success) {
    return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Plan inválido.' } };
  }
  const { planCode } = parsed.data;

  const blockers: PlanChangeBlockedReason[] = [];
  await dbAdmin(async (tx) => {
    for (const metric of METRICS_TO_CHECK) {
      const cap = getPlanLimit(planCode, metric);
      if (cap === -1) continue;
      const current = await readUsage(tx, session.orgId, metric);
      if (current > cap) blockers.push({ metric, current, newCap: cap });
    }
  });

  if (blockers.length > 0) {
    return {
      ok: false,
      error: {
        code: 'PLAN_LIMIT_REACHED',
        message:
          'No puedes bajar a este plan todavía: tu uso actual excede los límites. Ajusta los datos antes de cambiar.',
        blockers,
      },
    };
  }

  await dbAdmin(async (tx) => {
    const planRow = (
      await tx.select({ id: plans.id }).from(plans).where(eq(plans.code, planCode)).limit(1)
    )[0];
    if (!planRow) throw new Error(`plans row for ${planCode} not found.`);

    await tx
      .update(organizations)
      .set({ planId: planRow.id })
      .where(eq(organizations.id, session.orgId));

    // Mark previous active subscriptions canceled (history retained) and
    // open a new active one. Matches the Phase 12 ledger we'll get from
    // Stripe webhooks.
    await tx
      .update(subscriptions)
      .set({ status: 'canceled', cancelAt: new Date() })
      .where(
        and(
          eq(subscriptions.organizationId, session.orgId),
          eq(subscriptions.status, 'active'),
        ),
      );

    await tx.insert(subscriptions).values({
      organizationId: session.orgId,
      planId: planRow.id,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
  });

  revalidatePath('/billing');
  revalidatePath('/dashboard');
  return ok({ planCode });
}
