import { performSend } from '@/lib/emails/client';
import type {
  EmailLocale,
  EmailTemplate,
  TemplateData,
} from '@/lib/emails/templates';

import { inngest } from '../client';
import type { BlacknelEvents } from '../client';

/**
 * Event handler for `email.send` — durable, RETRYABLE transactional send. The
 * email client emits this (when Inngest is on) instead of sending inline;
 * Inngest retries on failure. Idempotency keyed on emailLogId so a redelivered
 * event doesn't double-send. Re-renders from the typed template + payload and
 * delegates to the shared `performSend` (flag-gated real-vs-mock).
 */
export async function runSendEmail(
  data: BlacknelEvents['email.send']['data'],
): Promise<'sent' | 'failed'> {
  return performSend({
    emailLogId: data.emailLogId ?? '',
    template: data.template as EmailTemplate,
    to: data.to,
    locale: data.locale as EmailLocale,
    data: data.payload as TemplateData[EmailTemplate],
  });
}

export const sendEmailFn = inngest.createFunction(
  {
    id: 'send-email',
    idempotency: 'event.data.emailLogId',
    triggers: [{ event: 'email.send' }],
  },
  async ({ event, step }) =>
    step.run('send', () =>
      runSendEmail(event.data as BlacknelEvents['email.send']['data']),
    ),
);
