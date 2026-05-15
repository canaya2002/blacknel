import { describe, expect, it } from 'vitest';

import { MockConnector } from '../../lib/connectors/base';
import { FACEBOOK_CAPABILITIES } from '../../lib/connectors/facebook/capabilities';
import { YELP_CAPABILITIES } from '../../lib/connectors/yelp/capabilities';

const account = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  brandId: null,
  locationId: null,
  platform: 'facebook' as const,
  externalAccountId: 'mock-ext-1',
  displayName: 'Test',
  handle: '@test',
  status: 'connected' as const,
};

describe('MockConnector — deterministic seed', () => {
  it('same account yields the same mock comments across two calls', async () => {
    const c1 = new MockConnector('facebook', FACEBOOK_CAPABILITIES);
    const c2 = new MockConnector('facebook', FACEBOOK_CAPABILITIES);
    const a = await c1.fetchComments(account, { limit: 5 });
    const b = await c2.fetchComments(account, { limit: 5 });
    expect(a.items.map((i) => i.externalId)).toEqual(b.items.map((i) => i.externalId));
  });

  it('different accounts yield different mock payloads', async () => {
    const c = new MockConnector('facebook', FACEBOOK_CAPABILITIES);
    const a = await c.fetchComments(account, { limit: 5 });
    const b = await c.fetchComments({ ...account, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { limit: 5 });
    expect(a.items.map((i) => i.externalId)).not.toEqual(b.items.map((i) => i.externalId));
  });

  it('sync returns a deterministic items count for the same account', async () => {
    const c = new MockConnector('facebook', FACEBOOK_CAPABILITIES);
    const r1 = await c.sync(account);
    const r2 = await c.sync(account);
    expect(r1.itemsSynced).toBe(r2.itemsSynced);
    expect(r1.itemsSynced).toBeGreaterThanOrEqual(0);
    expect(r1.itemsSynced).toBeLessThan(25);
  });

  it('reviews are bounded to 1..5 rating', async () => {
    const c = new MockConnector('yelp', YELP_CAPABILITIES);
    const yelpAccount = { ...account, platform: 'yelp' as const };
    const page = await c.fetchReviews(yelpAccount, { limit: 30 });
    for (const r of page.items) {
      expect(r.rating).toBeGreaterThanOrEqual(1);
      expect(r.rating).toBeLessThanOrEqual(5);
    }
  });
});
