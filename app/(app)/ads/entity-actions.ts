'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { runAdsStructureSync } from '@/lib/ads-connectors/ads-structure-sync';
import { applyAdsEntityAction } from '@/lib/ads/entity-actions';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for ads entity management (C50). Pause/resume/budget go through
 * `applyAdsEntityAction` (real Meta API when gated, else mock); `syncAdsNow`
 * triggers an on-demand structure sweep for the caller's org so freshly-connected
 * accounts surface without waiting for the cron. Both gate on `ads:manage`.
 */

const entityActionSchema = z.object({
  adsAccountId: z.string().uuid(),
  level: z.enum(['campaign', 'ad_set', 'ad']),
  externalId: z.string().min(1),
  action: z.enum(['pause', 'resume', 'set_budget']),
  dailyBudgetCents: z.number().int().positive().optional(),
});

export async function applyAdsEntityActionServer(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ externalId: string; status?: string; dailyBudgetCents?: number }>> {
  const session = await requireUser();
  authorize(session.role, 'ads:manage');

  const parsed = entityActionSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Solicitud de acción de ads inválida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const result = await applyAdsEntityAction({ orgId: session.orgId, ...parsed.data });
  if (result.ok) revalidatePath('/ads');
  return result;
}

export async function syncAdsNowAction(): Promise<
  Result<{ discovered: number; accounts: number; campaigns: number; adSets: number; ads: number }>
> {
  const session = await requireUser();
  authorize(session.role, 'ads:manage');

  // Structure + discovery only (org-scoped). Daily insights flow from the cron's
  // org-wide insights pass; a single-org manual insights run isn't exposed.
  const report = await runAdsStructureSync(undefined, { orgId: session.orgId });
  revalidatePath('/ads');
  return ok({
    discovered: report.discovered,
    accounts: report.accounts,
    campaigns: report.campaigns,
    adSets: report.adSets,
    ads: report.ads,
  });
}
