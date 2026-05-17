import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearDevOutbox, getDevOutbox } from '../../lib/emails/dev-outbox';
import { sendEmail } from '../../lib/emails/send';

/**
 * Phase 9 / Commit 34 — R-34-2 email infrastructure touch.
 *
 * The dev outbox now carries an optional `html` field alongside
 * `text`. Backwards compatible: every existing caller still works
 * with `text` only.
 */

beforeEach(() => clearDevOutbox());
afterEach(() => clearDevOutbox());

describe('sendEmail — multipart text + html (R-34-2)', () => {
  it('text-only call keeps the html field absent', async () => {
    await sendEmail({
      kind: 'invite',
      to: 'a@x.com',
      subject: 'hello',
      text: 'plain only',
    });
    const out = getDevOutbox();
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('plain only');
    expect(out[0]!.html).toBeUndefined();
  });

  it('multipart call stores both text and html', async () => {
    await sendEmail({
      kind: 'scheduled_report',
      to: 'b@x.com',
      subject: 'Weekly report',
      text: 'plain fallback',
      html: '<p>Hello <b>world</b></p>',
    });
    const out = getDevOutbox();
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe('plain fallback');
    expect(out[0]!.html).toBe('<p>Hello <b>world</b></p>');
    expect(out[0]!.kind).toBe('scheduled_report');
  });
});
