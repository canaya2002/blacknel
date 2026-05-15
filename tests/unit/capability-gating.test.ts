import { describe, expect, it } from 'vitest';

import {
  CapabilityNotSupportedError,
  MockConnector,
} from '../../lib/connectors/base';
import { YELP_CAPABILITIES } from '../../lib/connectors/yelp/capabilities';
import { LINKEDIN_CAPABILITIES } from '../../lib/connectors/linkedin/capabilities';

const account = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  brandId: null,
  locationId: null,
  platform: 'yelp' as const,
  externalAccountId: 'ext-1',
  displayName: null,
  handle: null,
  status: 'connected' as const,
};

describe('capability gating — unsupported capabilities throw', () => {
  it('Yelp.replyReview throws CapabilityNotSupportedError', async () => {
    const yelp = new MockConnector('yelp', YELP_CAPABILITIES);
    await expect(yelp.replyReview(account, 'review-1', 'gracias')).rejects.toThrow(
      CapabilityNotSupportedError,
    );
  });

  it('Yelp.fetchReviews succeeds (read_reviews IS supported)', async () => {
    const yelp = new MockConnector('yelp', YELP_CAPABILITIES);
    const result = await yelp.fetchReviews(account, { limit: 3 });
    expect(result.items.length).toBe(3);
  });

  it('LinkedIn.fetchComments throws (read_comments NOT supported)', async () => {
    const linkedin = new MockConnector('linkedin', LINKEDIN_CAPABILITIES);
    const liAccount = { ...account, platform: 'linkedin' as const };
    await expect(linkedin.fetchComments(liAccount, { limit: 3 })).rejects.toThrow(
      CapabilityNotSupportedError,
    );
  });

  it('CapabilityNotSupportedError exposes the platform + capability meta', async () => {
    const yelp = new MockConnector('yelp', YELP_CAPABILITIES);
    try {
      await yelp.replyReview(account, 'review-1', 'hi');
      throw new Error('expected throw');
    } catch (err) {
      if (!(err instanceof CapabilityNotSupportedError)) {
        throw err;
      }
      expect(err.platform).toBe('yelp');
      expect(err.capability).toBe('reply_reviews');
      expect(err.httpStatus).toBe(422);
    }
  });
});
