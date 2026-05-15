import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { hasOrg } from '@/lib/auth/constants';
import { requireUser } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { organizationMembers } from '@/lib/db/schema';
import { ONBOARDING_STEPS, readOnboardingState, type OnboardingStep } from '@/lib/onboarding/state';

import { StepBrand } from './step-brand';
import { StepConnect } from './step-connect';
import { StepLocation } from './step-location';
import { StepOrganization } from './step-organization';
import { StepPlan } from './step-plan';
import { StepTeam } from './step-team';
import { StepWelcome } from './step-welcome';

export const dynamic = 'force-dynamic';

/**
 * Onboarding hub. Single URL, no per-step route segment — the cookie
 * state machine (`lib/onboarding/state.ts`) decides which form to render.
 * Closing the tab and reopening lands on the same step.
 *
 * Entry behavior:
 *
 *   - User already a member of any org → /dashboard.
 *   - Session pinned to a real org but no cookie state → start fresh.
 *   - No org yet → render the current step (defaults to `organization`).
 */
export default async function OnboardingStartPage(): Promise<React.ReactElement> {
  const session = await requireUser();

  // If the user is already a member somewhere, onboarding is done.
  // dbAdmin sidesteps RLS — we're not trying to leak data, just count
  // memberships across all orgs the caller belongs to.
  const memberships = await dbAdmin<Array<{ id: string }>>(async (tx) =>
    tx
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, session.userId))
      .limit(1),
  );
  if (memberships.length > 0 && hasOrg(session.orgId)) {
    redirect('/dashboard');
  }

  const state = await readOnboardingState();
  const step: OnboardingStep = state?.step ?? 'organization';
  const completedSteps = new Set(
    ONBOARDING_STEPS.slice(0, ONBOARDING_STEPS.indexOf(step)),
  );

  return (
    <div className="flex flex-col gap-8">
      <StepIndicator currentStep={step} completed={completedSteps} />
      {step === 'organization' ? <StepOrganization /> : null}
      {step === 'plan' ? <StepPlan /> : null}
      {step === 'brand' ? <StepBrand /> : null}
      {step === 'location' ? <StepLocation /> : null}
      {step === 'connect' ? <StepConnect /> : null}
      {step === 'team' ? <StepTeam /> : null}
      {step === 'welcome' ? <StepWelcome /> : null}
    </div>
  );
}

const STEP_LABELS: Record<OnboardingStep, string> = {
  organization: 'Organización',
  plan: 'Plan',
  brand: 'Marca',
  location: 'Ubicación',
  connect: 'Conectar',
  team: 'Equipo',
  welcome: '¡Listo!',
};

function StepIndicator({
  currentStep,
  completed,
}: {
  currentStep: OnboardingStep;
  completed: Set<OnboardingStep>;
}): React.ReactElement {
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {ONBOARDING_STEPS.map((s, idx) => {
        const done = completed.has(s);
        const active = s === currentStep;
        return (
          <li
            key={s}
            className={`flex items-center gap-2 ${
              active
                ? 'font-medium text-foreground'
                : done
                ? 'text-emerald-600'
                : 'text-muted-foreground'
            }`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : done
                  ? 'bg-emerald-500 text-white'
                  : 'bg-muted'
              }`}
            >
              {done ? '✓' : idx + 1}
            </span>
            <span>{STEP_LABELS[s]}</span>
            {idx < ONBOARDING_STEPS.length - 1 ? (
              <span aria-hidden className="text-muted-foreground/40">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
