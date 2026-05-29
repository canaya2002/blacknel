import 'server-only';

import { eq } from 'drizzle-orm';

import { dbAdmin, type AnyPgTx } from '@/lib/db/client';
import { emailLog } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';
import { tryEmit } from '@/lib/inngest/client';
import { log } from '@/lib/log';

import type { ResendSendInput } from './adapter-resend';
import { fromHeader } from './senders';
import {
  renderTemplate,
  type EmailLocale,
  type EmailTemplate,
  type TemplateData,
} from './templates';

/**
 * Templated transactional email (C44). Renders a typed bilingual template,
 * writes an `email_log` row, then either EMITS an `email.send` Inngest event
 * (retryable, when use_real_inngest is on) or sends inline. The actual send is
 * flag-gated: real Resend only when RESEND_API_KEY is set AND
 * use_real_email='on'; otherwise a mock that logs + records (no network).
 *
 * email_log writes go through service_role; tests inject seams for the DB and
 * the Resend sender so CI never touches a DB or the network.
 */

// --- seams ------------------------------------------------------------------

type RunAdminFn = <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
let asAdmin: RunAdminFn = dbAdmin;
export function _setEmailDbDepsForTests(fn: RunAdminFn): void {
  asAdmin = fn;
}
export function _resetEmailDbDepsForTests(): void {
  asAdmin = dbAdmin;
}

type ResendSender = (i: ResendSendInput) => Promise<{ id: string }>;
let resendSender: ResendSender | null = null;
export function _setResendSenderForTests(fn: ResendSender | null): void {
  resendSender = fn;
}

// --- public API -------------------------------------------------------------

export interface SendTemplatedInput<T extends EmailTemplate> {
  readonly template: T;
  readonly to: string;
  readonly locale: EmailLocale;
  readonly data: TemplateData[T];
  /** NULL/omitted for system emails. */
  readonly orgId?: string | null;
  /** White-label hook (future): override the From display name. */
  readonly fromName?: string;
}

export interface SendResult {
  readonly emailLogId: string;
  readonly status: 'queued' | 'sent' | 'failed';
}

export async function sendTemplatedEmail<T extends EmailTemplate>(
  input: SendTemplatedInput<T>,
): Promise<SendResult> {
  const orgId = input.orgId ?? null;
  const emailLogId = await writeLog({
    orgId,
    to: input.to,
    template: input.template,
    locale: input.locale,
  });

  // Prefer the durable Inngest path (retry). When Inngest is off, send inline.
  const emitted = await tryEmit('email.send', {
    emailLogId,
    orgId,
    template: input.template,
    to: input.to,
    locale: input.locale,
    payload: input.data as Record<string, unknown>,
  });
  if (emitted) return { emailLogId, status: 'queued' };

  const status = await performSend({
    emailLogId,
    template: input.template,
    to: input.to,
    locale: input.locale,
    data: input.data,
    fromName: input.fromName,
  });
  return { emailLogId, status };
}

/**
 * Render + send a single email and update its log row. Shared by the inline
 * path and the Inngest `email.send` function. Flag-gated real-vs-mock.
 */
export async function performSend<T extends EmailTemplate>(p: {
  emailLogId: string;
  template: T;
  to: string;
  locale: EmailLocale;
  data: TemplateData[T];
  fromName?: string;
}): Promise<'sent' | 'failed'> {
  const rendered = renderTemplate(p.template, p.locale, p.data);
  const from = fromHeader(p.template, p.fromName);
  const useReal = Boolean(env.RESEND_API_KEY) && (await isFlagOn('use_real_email'));

  try {
    let resendId: string | null = null;
    if (useReal) {
      const send = resendSender ?? (await import('./adapter-resend')).resendSend;
      const r = await send({
        from,
        to: p.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      resendId = r.id;
    }
    // Mock path: no network — the email_log row IS the capture.
    await updateLog(p.emailLogId, { status: 'sent', resendId });
    log.info(
      { template: p.template, via: useReal ? 'resend' : 'mock', status: 'sent' },
      'email.sent',
    );
    return 'sent';
  } catch (err) {
    await updateLog(p.emailLogId, {
      status: 'failed',
      error: (err as Error).message.slice(0, 500),
    });
    log.error({ template: p.template, err: (err as Error).message }, 'email.failed');
    return 'failed';
  }
}

// --- email_log writes (service_role) ---------------------------------------

async function writeLog(p: {
  orgId: string | null;
  to: string;
  template: string;
  locale: string;
}): Promise<string> {
  const rows = await asAdmin<Array<{ id: string }>>((tx) =>
    tx
      .insert(emailLog)
      .values({
        organizationId: p.orgId,
        to: p.to,
        template: p.template,
        locale: p.locale,
        status: 'queued',
      })
      .returning({ id: emailLog.id }),
  );
  return rows[0]!.id;
}

async function updateLog(
  id: string,
  fields: { status: 'sent' | 'failed'; resendId?: string | null; error?: string },
): Promise<void> {
  await asAdmin((tx) =>
    tx
      .update(emailLog)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(emailLog.id, id)),
  );
}
