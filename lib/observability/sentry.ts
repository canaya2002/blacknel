import 'server-only';

import { env } from '@/lib/env';

import { redact } from './redact';

/**
 * Phase 11 / Commit 40 — server-side Sentry wrapper.
 *
 * Thin facade over `@sentry/nextjs`. Three reasons for the wrapper:
 *
 *   1. **No-op when disabled** — `BLACKNEL_USE_REAL_SENTRY=false` or
 *      missing DSN → every call returns without import overhead.
 *   2. **Redaction at the source** — `captureException` runs the
 *      `extra` payload through `redact()` before forwarding. The
 *      Sentry `beforeSend` hook adds a second pass on the whole
 *      event (defense in depth).
 *   3. **Test seam** — `__forceLoadForTests()` lets the unit test
 *      assert init logic without actually touching the Sentry SDK.
 *
 * The actual Sentry config files (`sentry.server.config.ts`,
 * `sentry.client.config.ts`, `sentry.edge.config.ts`) call
 * `Sentry.init` per-runtime. This wrapper is what application code
 * imports.
 */

interface SentryLike {
  readonly captureException: (
    error: unknown,
    context?: { extra?: Record<string, unknown>; tags?: Record<string, string> },
  ) => void;
  readonly setUser: (
    user: { id: string; organization_id: string; plan?: string } | null,
  ) => void;
  readonly setTag: (key: string, value: string) => void;
  readonly addBreadcrumb: (crumb: {
    message: string;
    category?: string;
    level?: 'info' | 'warning' | 'error';
  }) => void;
}

let cached: SentryLike | null = null;
let loadAttempted = false;

function isEnabled(): boolean {
  return env.BLACKNEL_USE_REAL_SENTRY && typeof env.SENTRY_DSN === 'string';
}

async function loadSdk(): Promise<SentryLike | null> {
  if (cached) return cached;
  if (loadAttempted) return cached;
  loadAttempted = true;
  if (!isEnabled()) return null;
  try {
    const mod = (await import('@sentry/nextjs')) as unknown as SentryLike;
    cached = mod;
    return mod;
  } catch {
    // SDK failed to load — fall back to no-op. Production never hits
    // this branch (dep is installed); dev/test does.
    return null;
  }
}

export async function captureException(
  error: unknown,
  context?: {
    extra?: Record<string, unknown>;
    tags?: Record<string, string>;
  },
): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  sdk.captureException(error, {
    ...(context?.extra ? { extra: redact(context.extra) } : {}),
    ...(context?.tags ? { tags: context.tags } : {}),
  });
}

export async function setUserContext(user: {
  userId: string;
  orgId: string;
  planCode?: string;
} | null): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  if (user === null) {
    sdk.setUser(null);
    return;
  }
  sdk.setUser({
    id: user.userId,
    organization_id: user.orgId,
    ...(user.planCode ? { plan: user.planCode } : {}),
  });
}

export async function setTag(key: string, value: string): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  sdk.setTag(key, value);
}

export async function addBreadcrumb(crumb: {
  message: string;
  category?: string;
  level?: 'info' | 'warning' | 'error';
}): Promise<void> {
  const sdk = await loadSdk();
  if (!sdk) return;
  sdk.addBreadcrumb(crumb);
}

/** Test-only seam. Resets the SDK cache so init logic can be re-tested. */
export function __resetForTests(): void {
  cached = null;
  loadAttempted = false;
}

export function __isEnabledForTests(): boolean {
  return isEnabled();
}
