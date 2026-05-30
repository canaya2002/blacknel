import { runMentionsSync } from '@/lib/connectors/mentions-sync';

import { inngest } from '../client';

/**
 * Cron: poll @mentions/tags on connected accounts (C53) — platforms don't push
 * them. Every 6h; classifies sentiment + upserts into listening_mentions under
 * each connection's org RLS. Logic in runMentionsSync (unit-testable without the
 * Inngest harness). This is the account-based achievable-via-API path; the
 * term-based broad-listening scan stays in the dev cron-loop.
 */
export const syncMentions = inngest.createFunction(
  { id: 'sync-mentions', triggers: [{ cron: '0 */6 * * *' }] }, // every 6 hours
  async ({ step }) => step.run('sync', () => runMentionsSync()),
);
