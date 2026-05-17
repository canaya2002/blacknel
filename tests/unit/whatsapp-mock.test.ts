import { describe, expect, it } from 'vitest';

import {
  sendTemplate,
  submitTemplate,
  synthesizeInboundMessage,
} from '../../lib/connectors/whatsapp/templates-mock';

/**
 * Phase 9 / Commit 31 — mock connector pure-function behavior.
 *
 *   - submitTemplate: FORBIDDEN token → rejected; otherwise approved.
 *   - sendTemplate: deterministic external id; renders variables.
 *   - synthesizeInboundMessage: deterministic external id.
 */

describe('submitTemplate', () => {
  it('approves a normal body', () => {
    const result = submitTemplate({ body: 'Hola {{1}}, gracias.' });
    expect(result.status).toBe('approved');
    expect(result.rejectedReason).toBeNull();
  });

  it('rejects a body containing FORBIDDEN', () => {
    const result = submitTemplate({
      body: '¡COMPRA YA! Oferta FORBIDDEN sin opt-in.',
    });
    expect(result.status).toBe('rejected');
    expect(result.rejectedReason).toMatch(/opt-in/i);
  });
});

describe('sendTemplate', () => {
  const now = new Date('2026-05-17T12:00:00Z');
  const input = {
    whatsappAccountId: '11111111-1111-4111-8111-c3100c3100c0',
    recipientPhone: '+52 55 1234 5678',
    templateName: 'order_update',
    templateLanguage: 'es',
    variables: { customer_name: 'Carolina', order_id: '8432' },
  };

  it('produces a deterministic external id for a fixed clock', () => {
    const a = sendTemplate(input, now);
    const b = sendTemplate(input, now);
    expect(a.externalMessageId).toBe(b.externalMessageId);
    expect(a.externalMessageId).toContain('order_update');
    expect(a.externalMessageId).toContain('+52 55 1234 5678');
  });

  it('renders variables into the body marker', () => {
    const result = sendTemplate(input, now);
    expect(result.renderedBody).toContain('customer_name=Carolina');
    expect(result.renderedBody).toContain('order_id=8432');
  });
});

describe('synthesizeInboundMessage', () => {
  it('produces a deterministic external id for inbound', () => {
    const now = new Date('2026-05-17T12:00:00Z');
    const out = synthesizeInboundMessage({
      contactPhone: '+52 55 0000 1111',
      body: 'Hola',
      now,
    });
    expect(out.externalMessageId).toContain('+52 55 0000 1111');
    expect(out.externalMessageId).toContain('2026-05-17T12:00:00');
  });
});
