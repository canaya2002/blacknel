import 'server-only';

import { cookies } from 'next/headers';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Onboarding state machine, persisted in a signed JWT cookie so the
 * user can close the tab, come back tomorrow, and resume on the same
 * step. Server-side state — no `useState`, no client routing — keeps
 * the flow robust against page reloads and works seamlessly with
 * Server Actions.
 *
 * IDs in the cookie reference rows the user just created. We sign so
 * tampering can't smuggle someone else's brand id; we still re-validate
 * ownership on each step before mutating, which is the actual security
 * boundary.
 */

const ONBOARDING_COOKIE = 'blacknel_onboarding';
const ONBOARDING_TTL_SECONDS = 60 * 60 * 24 * 7;
const VERSION = 1;

const STEPS = [
  'organization',
  'plan',
  'brand',
  'location',
  'connect',
  'team',
  'welcome',
] as const;
export type OnboardingStep = (typeof STEPS)[number];

const stateSchema = z.object({
  v: z.literal(VERSION),
  step: z.enum(STEPS),
  organizationId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

export type OnboardingState = z.infer<typeof stateSchema>;

const DEV_SECRET_FALLBACK =
  'blacknel-onboarding-dev-secret-do-not-use-in-prod-1234567890abcd';

function getSecret(): Uint8Array {
  if (env.BLACKNEL_COOKIE_SECRET) {
    return new TextEncoder().encode(env.BLACKNEL_COOKIE_SECRET);
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('BLACKNEL_COOKIE_SECRET is required in production.');
  }
  return new TextEncoder().encode(DEV_SECRET_FALLBACK);
}

export async function readOnboardingState(): Promise<OnboardingState | null> {
  const value = (await cookies()).get(ONBOARDING_COOKIE)?.value;
  if (!value) return null;
  try {
    const { payload } = await jwtVerify(value, getSecret(), { algorithms: ['HS256'] });
    const parsed = stateSchema.safeParse(payload);
    if (!parsed.success) return null;
    return parsed.data;
  } catch (err) {
    log.debug({ err }, 'onboarding.cookie.invalid');
    return null;
  }
}

export async function writeOnboardingState(state: Omit<OnboardingState, 'v'>): Promise<void> {
  const payload = { ...state, v: VERSION };
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ONBOARDING_TTL_SECONDS}s`)
    .sign(getSecret());
  (await cookies()).set(ONBOARDING_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ONBOARDING_TTL_SECONDS,
  });
}

export async function clearOnboardingState(): Promise<void> {
  (await cookies()).delete(ONBOARDING_COOKIE);
}

export const ONBOARDING_STEPS = STEPS;

export function stepIndex(step: OnboardingStep): number {
  return STEPS.indexOf(step);
}
