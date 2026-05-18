import * as Sentry from '@sentry/nextjs';

import { env } from '@/lib/env';
import { redact } from '@/lib/observability/redact';

/**
 * Phase 11 / Commit 40 — Sentry Node runtime init.
 *
 * Loaded by Next.js instrumentation hook on the server. No-ops when
 * BLACKNEL_USE_REAL_SENTRY=false or SENTRY_DSN missing — Sentry's
 * `init({ enabled: false })` short-circuits internally.
 *
 * `beforeSend` runs every event through the same `redact()` pass
 * `lib/observability/sentry.ts` uses for the extra payload. Belt +
 * suspenders.
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
    if (event.request?.headers) {
      event.request.headers = redact(event.request.headers);
    }
    return event;
  },
});
