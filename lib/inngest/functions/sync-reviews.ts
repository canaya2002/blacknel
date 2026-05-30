import { runReviewsSync } from '@/lib/connectors/reviews-sync';

import { inngest } from '../client';

/**
 * Cron: poll reviews for connected review-capable accounts (C49) — GBP has no
 * review webhooks. Every 6h; upserts under each connection's org RLS. Logic in
 * runReviewsSync for unit testing without the Inngest harness.
 */
export const syncReviews = inngest.createFunction(
  { id: 'sync-reviews', triggers: [{ cron: '0 */6 * * *' }] }, // every 6 hours
  async ({ step }) => step.run('sync', () => runReviewsSync()),
);
