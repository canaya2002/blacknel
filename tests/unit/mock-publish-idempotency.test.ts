import { afterEach, describe, expect, it } from 'vitest';

import {
  MOCK_IDEMPOTENCY_MAP,
  clearMockIdempotency,
  declareCapabilities,
  MockConnector,
  type ConnectorAccount,
} from '../../lib/connectors/base';

/**
 * Idempotency contract on `MockConnector.publishPost` /
 * `schedulePost` (Commit 17 Ajuste 2).
 *
 * Same `idempotencyKey` MUST return the same `externalId`. Two
 * different keys MUST return two different externalIds. Different
 * platforms with the same key are independent (key is namespaced
 * by platform in the Map).
 *
 * `BLACKNEL_MOCK_FAST_PUBLISH=true` is set so the 500–2000ms delay
 * inside `publishPost` collapses to 0 — keeps the test fast.
 */

process.env.BLACKNEL_MOCK_FAST_PUBLISH = 'true';

const account: ConnectorAccount = {
  id: '11111111-1111-4111-8111-aaa000000001',
  organizationId: '22222222-2222-4222-8222-aaa000000001',
  brandId: null,
  locationId: null,
  platform: 'facebook',
  externalAccountId: 'fb-test',
  displayName: 'Test FB',
  handle: '@test',
  status: 'connected',
};

const facebookConnector = new MockConnector(
  'facebook',
  declareCapabilities(['publish_post', 'schedule_post']),
);

const instagramConnector = new MockConnector(
  'instagram',
  declareCapabilities(['publish_post', 'schedule_post']),
);

afterEach(() => {
  clearMockIdempotency();
});

describe('publishPost — idempotency', () => {
  it('returns the same externalId for the same idempotencyKey', async () => {
    const key = 'idem-key-001';
    const first = await facebookConnector.publishPost(
      account,
      { text: 'hello world' },
      { idempotencyKey: key },
    );
    const second = await facebookConnector.publishPost(
      account,
      { text: 'hello world' },
      { idempotencyKey: key },
    );
    expect(second.externalId).toBe(first.externalId);
  });

  it('returns different externalIds for different idempotencyKeys', async () => {
    const a = await facebookConnector.publishPost(
      account,
      { text: 'hello world' },
      { idempotencyKey: 'idem-key-a' },
    );
    const b = await facebookConnector.publishPost(
      account,
      { text: 'hello world' },
      { idempotencyKey: 'idem-key-b' },
    );
    expect(b.externalId).not.toBe(a.externalId);
  });

  it('returns different externalIds when idempotencyKey is omitted', async () => {
    const first = await facebookConnector.publishPost(account, { text: 'hi' });
    const second = await facebookConnector.publishPost(account, { text: 'hi' });
    expect(second.externalId).not.toBe(first.externalId);
  });

  it('namespaces by platform — same key on different platforms returns different ids', async () => {
    const key = 'shared-key';
    const ig = await instagramConnector.publishPost(
      { ...account, platform: 'instagram' },
      { text: 'hi' },
      { idempotencyKey: key },
    );
    const fb = await facebookConnector.publishPost(
      account,
      { text: 'hi' },
      { idempotencyKey: key },
    );
    expect(fb.externalId).not.toBe(ig.externalId);
  });

  it('writes the entry into MOCK_IDEMPOTENCY_MAP', async () => {
    expect(MOCK_IDEMPOTENCY_MAP.size).toBe(0);
    await facebookConnector.publishPost(
      account,
      { text: 'hello' },
      { idempotencyKey: 'observable' },
    );
    expect(MOCK_IDEMPOTENCY_MAP.size).toBe(1);
    expect(MOCK_IDEMPOTENCY_MAP.get('facebook::observable')).toBeDefined();
  });

  it('clearMockIdempotency() resets the cache', async () => {
    await facebookConnector.publishPost(
      account,
      { text: 'hello' },
      { idempotencyKey: 'will-be-cleared' },
    );
    expect(MOCK_IDEMPOTENCY_MAP.size).toBe(1);
    clearMockIdempotency();
    expect(MOCK_IDEMPOTENCY_MAP.size).toBe(0);
  });
});

describe('schedulePost — idempotency', () => {
  it('returns the same externalId for the same idempotencyKey', async () => {
    const when = new Date(Date.now() + 60 * 60 * 1000);
    const first = await facebookConnector.schedulePost(
      account,
      { text: 'scheduled' },
      when,
      { idempotencyKey: 'sched-001' },
    );
    const second = await facebookConnector.schedulePost(
      account,
      { text: 'scheduled' },
      when,
      { idempotencyKey: 'sched-001' },
    );
    expect(second.externalId).toBe(first.externalId);
  });
});
