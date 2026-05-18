import 'server-only';

import { env } from '@/lib/env';

import { redact } from './redact';

/**
 * Phase 11 / Commit 40 — server-side PostHog wrapper.
 *
 * Captures named product events from Server Actions / Server
 * Components. NO PII is sent — only `(orgId, userId, planCode)`
 * identifiers. The redact pass on `properties` defends against
 * accidental leaks (a Server Action passing `{ email }` by
 * mistake gets that field redacted before send).
 *
 * # Initial event whitelist
 *
 * Adding a new event requires updating `PostHogEventName` here so
 * the type system gates what we capture. Avoids capture sprawl.
 */

export type PostHogEventName =
  | 'custom_report.created'
  | 'custom_report.published'
  | 'custom_report.shared'
  | 'nps_response.submitted'
  | 'crisis.detected'
  | 'crisis.resolved'
  | 'plan.upgrade_clicked'
  | 'plan.changed'
  | 'review.published'
  | 'connector.connected'
  | 'connector.disconnected';

interface PostHogLike {
  readonly capture: (
    event: { distinctId: string; event: string; properties?: Record<string, unknown> },
  ) => void;
  readonly identify: (
    payload: { distinctId: string; properties?: Record<string, unknown> },
  ) => void;
  readonly shutdown: () => Promise<void>;
}

let cached: PostHogLike | null = null;
let loadAttempted = false;

function isEnabled(): boolean {
  return env.BLACKNEL_USE_REAL_POSTHOG && typeof env.POSTHOG_KEY === 'string';
}

async function loadSdk(): Promise<PostHogLike | null> {
  if (cached) return cached;
  if (loadAttempted) return cached;
  loadAttempted = true;
  if (!isEnabled()) return null;
  try {
    const mod = await import('posthog-node');
    const Client = mod.PostHog;
    const client = new Client(env.POSTHOG_KEY as string, {
      host: env.POSTHOG_HOST,
      flushAt: 20,
      flushInterval: 10_000,
    });
    cached = client as unknown as PostHogLike;
    return cached;
  } catch {
    return null;
  }
}

export async function capture(
  event: PostHogEventName,
  identity: { userId: string; orgId: string; planCode?: string },
  properties: Record<string, unknown> = {},
): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  const safeProps = redact(properties);
  sdk.capture({
    distinctId: identity.userId,
    event,
    properties: {
      ...safeProps,
      organization_id: identity.orgId,
      ...(identity.planCode ? { plan_code: identity.planCode } : {}),
    },
  });
}

export async function identify(
  identity: { userId: string; orgId: string; planCode?: string },
  extra: Record<string, unknown> = {},
): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  sdk.identify({
    distinctId: identity.userId,
    properties: {
      ...redact(extra),
      organization_id: identity.orgId,
      ...(identity.planCode ? { plan_code: identity.planCode } : {}),
    },
  });
}

/**
 * Required on serverless shutdown to flush in-flight events.
 * Vercel's `cleanup` hook invokes this; tests use `__resetForTests`.
 */
export async function shutdown(): Promise<void> {
  if (cached) {
    await cached.shutdown();
  }
}

export function __resetForTests(): void {
  cached = null;
  loadAttempted = false;
}

export function __isEnabledForTests(): boolean {
  return isEnabled();
}
