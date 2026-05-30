import { runConnectionTokenRefresh } from '@/lib/connectors/refresh';

import { inngest } from '../client';

/**
 * Cron: refresh soon-to-expire connector tokens across ALL platforms (C48,
 * generalized from the C46 FB/IG-only cron). Daily sweep; per-platform refresh
 * under each connection's org RLS; failures mark the connection expired. Logic in
 * runConnectionTokenRefresh for unit testing without the Inngest harness.
 */
export const refreshConnectionTokens = inngest.createFunction(
  { id: 'refresh-connection-tokens', triggers: [{ cron: '0 4 * * *' }] }, // daily 04:00 UTC
  async ({ step }) => step.run('refresh', () => runConnectionTokenRefresh()),
);
