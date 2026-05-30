import { processMetaWebhookEvent } from '@/lib/connectors/meta/inbound';

import { inngest } from '../client';
import type { BlacknelEvents } from '../client';

/**
 * Event handler for `meta.inbound` (C46) — durable, retryable processing of a
 * stored Meta webhook event into the inbox. Idempotent on the webhook event id
 * (and inbox messages dedupe internally), so retries are safe. Logic lives in
 * `processMetaWebhookEvent` so it's unit-testable without the Inngest harness.
 */
export const metaProcessInbound = inngest.createFunction(
  {
    id: 'meta-process-inbound',
    idempotency: 'event.data.webhookEventId',
    triggers: [{ event: 'meta.inbound' }],
  },
  async ({ event, step }) =>
    step.run('process', () =>
      processMetaWebhookEvent(event.data as BlacknelEvents['meta.inbound']['data']),
    ),
);
