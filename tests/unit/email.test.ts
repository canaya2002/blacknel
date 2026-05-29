import { eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * C44 email subsystem. ZERO network: the `resend` SDK is never imported (the
 * client's resend-sender seam intercepts the real path), and `@/lib/env` is
 * mocked so the RESEND_API_KEY gate is controllable. Covers bilingual template
 * rendering + escaping, sender addresses, email_log persistence (no body),
 * flag+key gating (real-vs-mock), failure handling, and the Inngest-vs-inline
 * branch.
 */

// Controllable env — only `env` is consumed as a value across the import graph
// (db/client reads it lazily inside getRawDb, never called here; log + inngest
// client read a few fields at load). Mutated per-test to flip the key gate.
const H = vi.hoisted(() => ({
  env: {
    NODE_ENV: 'test' as string,
    RESEND_API_KEY: undefined as string | undefined,
    INNGEST_EVENT_KEY: undefined as string | undefined,
    LOG_LEVEL: undefined as string | undefined,
    LOG_FORMAT: undefined as string | undefined,
  },
}));
vi.mock('@/lib/env', () => ({ env: H.env }));

const { runAdmin } = await import('../../lib/db/client');
const { emailLog, organizations, plans } = await import('../../lib/db/schema');
const { _resetFlagReaderForTests, _setFlagReaderForTests } = await import(
  '../../lib/flags'
);
const { _setInngestEmitForTests } = await import('../../lib/inngest/client');
const {
  performSend,
  sendTemplatedEmail,
  _resetEmailDbDepsForTests,
  _setEmailDbDepsForTests,
  _setResendSenderForTests,
} = await import('../../lib/emails/client');
const { runSendEmail } = await import(
  '../../lib/inngest/functions/send-email'
);
const { renderTemplate } = await import('../../lib/emails/templates');
const { SENDERS, SENDER_FOR_TEMPLATE, fromHeader } = await import(
  '../../lib/emails/senders'
);
const { createTestDb } = await import('../helpers/test-db');
type TestDb = Awaited<ReturnType<typeof createTestDb>>;

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-e00000000001';
const orgId = '66666666-6666-4666-8666-a00000000001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx
      .insert(plans)
      .values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
    await tx
      .insert(organizations)
      .values({ id: orgId, name: 'Email Org', slug: 'email-org', planId });
  });
  _setEmailDbDepsForTests((fn) => runAdmin(fixture.db, fn));
}, 60_000);

afterAll(async () => {
  _resetEmailDbDepsForTests();
  _resetFlagReaderForTests();
  _setInngestEmitForTests(null);
  _setResendSenderForTests(null);
  await fixture.dispose();
});

beforeEach(() => {
  // Defaults: no key, flag off, Inngest off (inline), no sender seam.
  H.env.RESEND_API_KEY = undefined;
  H.env.INNGEST_EVENT_KEY = undefined;
  _setFlagReaderForTests(() => Promise.resolve('off'));
  _setInngestEmitForTests(null);
  _setResendSenderForTests(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- pure rendering --------------------------------------------------------

describe('renderTemplate — bilingual', () => {
  it('team_invite differs es vs en and includes the accept button', () => {
    const data = {
      orgName: 'Acme',
      inviterName: 'Ana',
      acceptUrl: 'https://app.blacknel.com/invite/abc',
    };
    const es = renderTemplate('team_invite', 'es', data);
    const en = renderTemplate('team_invite', 'en', data);
    expect(es.subject).toContain('te invitó');
    expect(en.subject).toContain('invited you');
    expect(es.subject).not.toBe(en.subject);
    expect(es.html).toContain(data.acceptUrl);
    expect(es.html).toContain('Aceptar invitación');
    expect(en.html).toContain('Accept invitation');
    expect(es.text).toContain(data.acceptUrl);
  });

  it('billing_notification, data_deletion, generic all render subject/html/text', () => {
    const billing = renderTemplate('billing_notification', 'en', {
      orgName: 'Acme',
      message: 'Payment received',
    });
    expect(billing.subject).toBe('Billing — Acme');
    expect(billing.html).toContain('Payment received');

    const ddel = renderTemplate('data_deletion_confirmation', 'es', {
      requestCode: 'DEL-123',
      statusUrl: 'https://app.blacknel.com/del/DEL-123',
    });
    expect(ddel.subject).toContain('eliminación');
    expect(ddel.html).toContain('DEL-123');
    expect(ddel.html).toContain('Ver estado');

    const gen = renderTemplate('generic_notification', 'en', {
      title: 'Heads up',
      body: 'Something happened',
      ctaUrl: 'https://x.test',
      ctaLabel: 'Open',
    });
    expect(gen.subject).toBe('Heads up');
    expect(gen.html).toContain('Open');

    const genNoCta = renderTemplate('generic_notification', 'en', {
      title: 'Heads up',
      body: 'No CTA',
    });
    expect(genNoCta.html).not.toContain('<a href');
  });

  it('escapes HTML in user-provided values (XSS-safe)', () => {
    const r = renderTemplate('team_invite', 'en', {
      orgName: '<script>alert(1)</script>',
      inviterName: 'Eve & "co"',
      acceptUrl: 'https://x.test',
    });
    expect(r.html).not.toContain('<script>alert(1)</script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(r.html).toContain('&amp;');
    expect(r.html).toContain('&quot;');
  });
});

describe('senders', () => {
  it('maps each template to its typed Blacknel address', () => {
    expect(SENDER_FOR_TEMPLATE.billing_notification).toBe(SENDERS.billing);
    expect(SENDER_FOR_TEMPLATE.data_deletion_confirmation).toBe(SENDERS.privacy);
    expect(SENDER_FOR_TEMPLATE.team_invite).toBe(SENDERS.transactional);
    expect(fromHeader('billing_notification')).toBe('Blacknel <billing@blacknel.com>');
  });

  it('honors the white-label fromName override', () => {
    expect(fromHeader('team_invite', 'Acme Social')).toBe(
      'Acme Social <noreply@blacknel.com>',
    );
  });
});

// --- send flow + logging + gating ------------------------------------------

async function readLog(id: string) {
  const rows = await runAdmin<
    Array<{ status: string; resendId: string | null; error: string | null; to: string }>
  >(fixture.db, (tx) =>
    tx
      .select({
        status: emailLog.status,
        resendId: emailLog.resendId,
        error: emailLog.error,
        to: emailLog.to,
      })
      .from(emailLog)
      .where(eq(emailLog.id, id)),
  );
  return rows[0];
}

describe('sendTemplatedEmail — inline (Inngest off)', () => {
  it('writes an email_log row and records sent via the mock (no key)', async () => {
    const res = await sendTemplatedEmail({
      template: 'data_deletion_confirmation',
      to: 'user@example.com',
      locale: 'en',
      data: { requestCode: 'DEL-9', statusUrl: 'https://x.test' },
      orgId: null,
    });
    expect(res.status).toBe('sent');
    const row = await readLog(res.emailLogId);
    expect(row?.status).toBe('sent');
    expect(row?.resendId).toBeNull(); // mock path — no provider id
    expect(row?.to).toBe('user@example.com');
    // No `body` column exists on email_log — body is never persisted.
    expect(Object.keys(emailLog)).not.toContain('body');
  });

  it('does NOT call the real sender when the flag is OFF (even with a key)', async () => {
    H.env.RESEND_API_KEY = 'test_key';
    _setFlagReaderForTests(() => Promise.resolve('off'));
    const sender = vi.fn(async () => ({ id: 're_should_not_be_called' }));
    _setResendSenderForTests(sender);

    const res = await sendTemplatedEmail({
      template: 'generic_notification',
      to: 'a@b.test',
      locale: 'en',
      data: { title: 'T', body: 'B' },
      orgId,
    });
    expect(sender).not.toHaveBeenCalled();
    expect(res.status).toBe('sent');
    expect((await readLog(res.emailLogId))?.resendId).toBeNull();
  });

  it('does NOT call the real sender when the key is missing (flag ON)', async () => {
    H.env.RESEND_API_KEY = undefined;
    _setFlagReaderForTests(() => Promise.resolve('on'));
    const sender = vi.fn(async () => ({ id: 're_x' }));
    _setResendSenderForTests(sender);

    const res = await sendTemplatedEmail({
      template: 'generic_notification',
      to: 'a@b.test',
      locale: 'en',
      data: { title: 'T', body: 'B' },
      orgId,
    });
    expect(sender).not.toHaveBeenCalled();
    expect(res.status).toBe('sent');
  });

  it('calls the real sender ONLY when key AND flag are both on; stores resendId', async () => {
    H.env.RESEND_API_KEY = 'test_key';
    _setFlagReaderForTests(() => Promise.resolve('on'));
    const sender = vi.fn(
      async (_i: {
        from: string;
        to: string;
        subject: string;
        html: string;
        text: string;
      }) => ({ id: 're_live_123' }),
    );
    _setResendSenderForTests(sender);

    const res = await sendTemplatedEmail({
      template: 'billing_notification',
      to: 'pay@b.test',
      locale: 'es',
      data: { orgName: 'Acme', message: 'Pago recibido' },
      orgId,
    });
    expect(sender).toHaveBeenCalledTimes(1);
    const arg = sender.mock.calls[0]![0];
    expect(arg.from).toBe('Blacknel <billing@blacknel.com>');
    expect(arg.to).toBe('pay@b.test');
    expect(arg.subject).toContain('Acme');
    expect(arg.html).toContain('Pago recibido');
    expect(res.status).toBe('sent');
    expect((await readLog(res.emailLogId))?.resendId).toBe('re_live_123');
  });

  it('records failed + stores the (truncated) error when the sender throws', async () => {
    H.env.RESEND_API_KEY = 'test_key';
    _setFlagReaderForTests(() => Promise.resolve('on'));
    _setResendSenderForTests(async () => {
      throw new Error('Resend 422 invalid recipient');
    });

    const res = await sendTemplatedEmail({
      template: 'generic_notification',
      to: 'bad',
      locale: 'en',
      data: { title: 'T', body: 'B' },
      orgId,
    });
    expect(res.status).toBe('failed');
    const row = await readLog(res.emailLogId);
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('Resend 422');
  });
});

describe('sendTemplatedEmail — Inngest path (durable)', () => {
  it('emits email.send and returns queued WITHOUT sending inline', async () => {
    const events: Array<{ name: string; data: unknown }> = [];
    _setInngestEmitForTests(async (name, data) => {
      events.push({ name, data });
    });
    const sender = vi.fn(async () => ({ id: 're_inline' }));
    _setResendSenderForTests(sender);

    const res = await sendTemplatedEmail({
      template: 'generic_notification',
      to: 'q@b.test',
      locale: 'en',
      data: { title: 'Queued', body: 'B' },
      orgId,
    });
    expect(res.status).toBe('queued');
    expect(sender).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]!.name).toBe('email.send');
    expect((events[0]!.data as { emailLogId: string }).emailLogId).toBe(
      res.emailLogId,
    );

    // The Inngest function then performs the send for that log row.
    const data = events[0]!.data as {
      emailLogId: string;
      template: string;
      to: string;
      locale: string;
      payload: Record<string, unknown>;
    };
    const status = await runSendEmail({ ...data, orgId });
    expect(status).toBe('sent'); // mock (no key)
    expect((await readLog(res.emailLogId))?.status).toBe('sent');
  });
});

describe('performSend — direct', () => {
  it('renders + records sent for a pre-existing queued row (mock path)', async () => {
    const ids = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .insert(emailLog)
        .values({ to: 't@b.test', template: 'generic_notification', status: 'queued' })
        .returning({ id: emailLog.id }),
    );
    const id = ids[0]!.id;
    const status = await performSend({
      emailLogId: id,
      template: 'generic_notification',
      to: 't@b.test',
      locale: 'en',
      data: { title: 'T', body: 'B' },
    });
    expect(status).toBe('sent');
    expect((await readLog(id))?.status).toBe('sent');
  });
});
