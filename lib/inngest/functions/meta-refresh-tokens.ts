import { runMetaTokenRefresh } from '@/lib/connectors/meta/refresh';

import { inngest } from '../client';

/**
 * Cron: refresh Meta connection tokens nearing expiry (C46). Daily sweep — long-
 * lived Page tokens last ~60 days; this re-derives them inside a 7-day window.
 * System-wide scan (admin) but each refresh runs under its org RLS. Logic in
 * `runMetaTokenRefresh` for unit testing without the Inngest harness.
 */
export const metaRefreshTokens = inngest.createFunction(
  { id: 'meta-refresh-tokens', triggers: [{ cron: '0 4 * * *' }] }, // daily 04:00 UTC
  async ({ step }) => step.run('refresh', () => runMetaTokenRefresh()),
);
