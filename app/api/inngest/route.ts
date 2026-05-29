import { serve } from 'inngest/next';

import { env } from '@/lib/env';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

// Node runtime + always-dynamic: this endpoint runs durable job logic (DB,
// SDKs) and must never be statically optimized.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Inngest serve endpoint (Phase 11 / C44). Inngest invokes this to run the
 * registered functions. The proxy matcher (proxy.ts) excludes `/api/inngest`
 * from the auth gate + kill switch — auth here is Inngest's request SIGNATURE
 * (INNGEST_SIGNING_KEY), the same posture as the Meta webhook. Never open
 * without the signing key in production.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  ...(env.INNGEST_SIGNING_KEY ? { signingKey: env.INNGEST_SIGNING_KEY } : {}),
});
