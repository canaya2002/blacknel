import 'server-only';

import { Resend } from 'resend';

import { env } from '@/lib/env';

/**
 * Real Resend adapter (C44). Only invoked when RESEND_API_KEY is set AND
 * use_real_email='on' (gated in lib/emails/client.ts). Tests mock this via the
 * client's resend-sender seam — a real send NEVER happens in CI.
 */

let _client: Resend | null = null;

function getClient(): Resend {
  if (!_client) _client = new Resend(env.RESEND_API_KEY ?? '');
  return _client;
}

/** Test seam. */
export function _resetResendClientForTests(): void {
  _client = null;
}

export interface ResendSendInput {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export async function resendSend(input: ResendSendInput): Promise<{ id: string }> {
  const res = await getClient().emails.send({
    from: input.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  if (res.error) {
    throw new Error(`Resend error: ${res.error.message}`);
  }
  return { id: res.data?.id ?? '' };
}
