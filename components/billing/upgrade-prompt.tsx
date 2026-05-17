import { ArrowUpRight, Lock } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { dbAdmin } from '@/lib/db/client';
import { auditEvents } from '@/lib/db/schema';
import { log } from '@/lib/log';
import { PLANS, type PlanCode } from '@/lib/plans/plans';

interface UpgradePromptProps {
  /** Plan tier required to unlock the feature. */
  unlocksOn: 'growth' | 'enterprise';
  /** Human-readable name of the feature for the headline. */
  featureName: string;
  /** 2–3 short bullets describing what the user unlocks. */
  valueBullets: ReadonlyArray<string>;
  /** Caller's resolved current plan. */
  currentPlan: PlanCode;
  /** Org id for the audit event metadata. */
  organizationId: string;
}

const PLAN_RANK: Record<PlanCode, number> = {
  standard: 0,
  growth: 1,
  enterprise: 2,
};

/**
 * Reusable plan-gated upgrade prompt (Phase 9 / Commit 31 ·
 * Ajuste 2).
 *
 * Used by every Growth-tier feature (WhatsApp Business, NPS,
 * Listening, Competitors, Scheduled reports) and Phase-8
 * Enterprise gating. Differs from the legacy
 * `components/common/upgrade-prompt.tsx`:
 *
 *   - Self-hides when `currentPlan >= unlocksOn` (returns null).
 *   - Renders a value-prop bullet list instead of a plain
 *     description.
 *   - Emits an `upgrade_prompt.shown` audit row so we can
 *     measure conversion intent (Phase 12 dashboard).
 *
 * Server Component — the audit row writes via `dbAdmin` on
 * every render. That's intentional: one audit per view-event.
 * Wrapped in try/catch so an audit failure can't crash the
 * page render.
 */
export async function UpgradePrompt({
  unlocksOn,
  featureName,
  valueBullets,
  currentPlan,
  organizationId,
}: UpgradePromptProps): Promise<React.ReactElement | null> {
  if (PLAN_RANK[currentPlan] >= PLAN_RANK[unlocksOn]) {
    return null;
  }

  // Audit event on render. try/catch keeps the page resilient.
  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId,
        userId: null,
        actorType: 'system',
        action: 'upgrade_prompt.shown',
        entityType: 'feature_gate',
        entityId: null,
        after: {
          feature: featureName,
          current_plan: currentPlan,
          target_plan: unlocksOn,
        },
        riskLevel: 'low',
      }),
    );
  } catch (err) {
    log.error(
      { err: (err as Error).message, feature: featureName },
      'upgrade_prompt.audit_failed',
    );
  }

  const targetPlan = PLANS[unlocksOn];
  const price = (targetPlan.priceCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  return (
    <Card
      className="border-amber-500/40 bg-amber-50/40 p-4 dark:bg-amber-950/20"
      role="region"
      aria-label={`Upgrade prompt for ${featureName}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 text-amber-600" aria-hidden />
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-sm font-semibold">
                {featureName}
              </div>
              <div className="text-xs text-muted-foreground">
                Disponible en plan {targetPlan.name} ({price}/mes)
              </div>
            </div>
            {valueBullets.length > 0 ? (
              <ul className="ml-1 list-disc space-y-0.5 pl-3 text-xs text-muted-foreground">
                {valueBullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/billing" prefetch={false}>
            Upgrade plan
            <ArrowUpRight className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </div>
    </Card>
  );
}
