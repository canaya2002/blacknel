import 'server-only';

import { log } from '../log';

import { pushToDevOutbox } from './dev-outbox';

/**
 * Email-sending abstraction.
 *
 * Phases 1–10: every call is logged + pushed into the in-memory dev
 * outbox so tests and the UI can confirm an email "would have been
 * sent". No SMTP, no Resend, no network traffic. Invitations also
 * surface their acceptance link directly in /team's "Pending
 * invitations" list, so users never depend on email delivery during
 * development.
 *
 * Phase 11 cutover swaps this single file for the Resend client. The
 * shape of `sendEmail()` stays — every caller (invitations,
 * verification, password reset, NPS prompts, review requests, scheduled
 * reports, crisis alerts) keeps working without edits.
 *
 * The `kind` discriminator is intentional: when Resend goes live we
 * will template-tag each kind in their dashboard for deliverability +
 * analytics rather than rebuilding the call sites.
 */

export type EmailKind =
  | 'invite'
  | 'verification'
  | 'password_reset'
  | 'review_request'
  | 'scheduled_report'
  | 'crisis_alert'
  | 'nps_prompt';

export interface SendEmailInput {
  kind: EmailKind;
  to: string;
  subject: string;
  /** Plain-text body. HTML can be added in Phase 11 alongside the Resend wiring. */
  text: string;
  /** Per-email structured metadata for logs / analytics. */
  meta?: Record<string, unknown>;
}

export interface SendEmailResult {
  /** Always `true` in dev — the outbox accepts every message. */
  ok: boolean;
  /** Same id Resend returns in Phase 11; here it's a deterministic dev id. */
  id: string;
}

let _devCounter = 0;

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  _devCounter += 1;
  const id = `dev-${Date.now()}-${_devCounter}`;
  log.info(
    { kind: input.kind, to: input.to, subject: input.subject, id },
    'email.send (dev outbox — Resend wires in Phase 11)',
  );
  pushToDevOutbox({
    id,
    kind: input.kind,
    to: input.to,
    subject: input.subject,
    text: input.text,
    meta: input.meta,
    sentAt: new Date(),
  });
  return { ok: true, id };
}
