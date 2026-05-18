import * as Sentry from '@sentry/nextjs';

import { env } from '@/lib/env';
import { redact } from '@/lib/observability/redact';

/**
 * Phase 11 / Commit 40 — Sentry Edge runtime init (middleware,
 * route handlers running on Vercel Edge). Same shape as
 * `sentry.server.config.ts` but the Edge runtime is more
 * restricted — no Node APIs available.
 */

const enabled =
  env.BLACKNEL_USE_REAL_SENTRY && typeof env.SENTRY_DSN === 'string';

Sentry.init({
  enabled,
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    if (event.extra) event.extra = redact(event.extra);
    if (event.contexts) event.contexts = redact(event.contexts);
    return event;
  },
});
