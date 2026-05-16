import { Lock } from 'lucide-react';

import type { PlatformCode } from '@/lib/connectors/base';
import { planAllowsPlatform } from '@/lib/plans/gating';
import { type PlanCode } from '@/lib/plans/plans';

interface GatedPlatformBannerProps {
  /** Platforms the URL asked for that the active plan does NOT include. */
  gatedPlatforms: ReadonlyArray<PlatformCode>;
  /** Active plan, used to compute "lowest plan that *would* include this". */
  plan: PlanCode;
}

/**
 * Banner above the reviews list when one or more URL-pasted platforms
 * were dropped by the filter parser for plan reasons (Ajuste 1). The
 * filter is dropped *silently* in `parseReviewFilters` to keep query
 * semantics consistent (drop-on-suspicious is global policy from
 * Commit 8); the banner is what makes the silent drop visible to the
 * user instead of looking like a "missing rows" bug.
 *
 * No interactive controls — this is a notice. The upgrade prompt
 * surfaces from the dropdown / pricing pages, not from here.
 */
export function GatedPlatformBanner({
  gatedPlatforms,
  plan,
}: GatedPlatformBannerProps): React.ReactElement | null {
  if (gatedPlatforms.length === 0) return null;

  const items = gatedPlatforms.map((p) => ({
    platform: p,
    requiredPlan: lowestPlanIncluding(p),
  }));

  return (
    <div
      role="status"
      className="mx-4 my-2 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
      data-testid="gated-platform-banner"
    >
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="flex flex-col gap-0.5">
        {items.map(({ platform, requiredPlan }) => (
          <span key={platform}>
            <span className="font-medium uppercase">{platform}</span> requiere plan{' '}
            <span className="capitalize">{requiredPlan ?? 'superior'}</span> — filtro
            ignorado. Tu plan actual es{' '}
            <span className="capitalize">{plan}</span>.
          </span>
        ))}
      </div>
    </div>
  );
}

function lowestPlanIncluding(platform: PlatformCode): PlanCode | null {
  for (const code of ['standard', 'growth', 'enterprise'] as PlanCode[]) {
    if (planAllowsPlatform(code, platform)) return code;
  }
  return null;
}
