import { describe, expect, it } from 'vitest';

import type { Capability, PlatformCode } from '../../lib/connectors/base';
import { getCapabilities } from '../../lib/connectors/registry';

/**
 * Capability contract snapshot. The exact list per platform must
 * mirror what the real API allows in Phase 11 — drift here means the
 * UI shows buttons that 404 in production. Treat this file as a
 * contract — any change must come with a comment explaining the API
 * shift it tracks.
 */

const EXPECTED: Record<Exclude<PlatformCode, 'mock'>, ReadonlyArray<Capability>> = {
  facebook: [
    'read_comments',
    'reply_comments',
    'read_dms',
    'send_dms',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
  instagram: [
    'read_comments',
    'reply_comments',
    'read_dms',
    'send_dms',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
  // Commit 17 extended gbp to declare publish_post + schedule_post for
  // GBP local posts (distinct from reviews — see capabilities.ts).
  gbp: [
    'read_reviews',
    'reply_reviews',
    'read_insights',
    'send_review_request',
    'publish_post',
    'schedule_post',
  ],
  whatsapp: ['read_dms', 'send_dms', 'read_insights'],
  tiktok: [
    'read_comments',
    'reply_comments',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
  linkedin: ['publish_post', 'schedule_post', 'read_insights'],
  x: ['publish_post', 'schedule_post', 'read_dms', 'send_dms', 'read_mentions'],
  yelp: ['read_reviews'], // intentionally no reply_reviews — API is read-only
  tripadvisor: ['read_reviews', 'reply_reviews'],
  trustpilot: ['read_reviews', 'reply_reviews'],
  bbb: ['read_reviews'],
  avvo: ['read_reviews'],
  // Commit 17 extended youtube to declare publish_post + schedule_post
  // covering both Community posts and video uploads via Videos.insert.
  youtube: [
    'read_comments',
    'reply_comments',
    'read_insights',
    'publish_post',
    'schedule_post',
  ],
  pinterest: ['publish_post', 'schedule_post'],
  reddit: ['read_mentions', 'listening_source'],
};

describe('capability contracts (real-API truth)', () => {
  for (const [platform, expected] of Object.entries(EXPECTED) as Array<
    [Exclude<PlatformCode, 'mock'>, ReadonlyArray<Capability>]
  >) {
    it(`${platform} exposes the documented capabilities — no more, no less`, () => {
      const caps = getCapabilities(platform);
      expect(new Set(caps.supported)).toEqual(new Set(expected));
    });
  }

  it('yelp explicitly does NOT include reply_reviews', () => {
    const yelp = getCapabilities('yelp');
    expect(yelp.supported).not.toContain('reply_reviews');
    expect(yelp.notes?.read_reviews).toBeTruthy(); // explanatory note required
  });

  it('bbb and avvo carry explanatory notes (no public API)', () => {
    expect(getCapabilities('bbb').notes?.read_reviews).toBeTruthy();
    expect(getCapabilities('avvo').notes?.read_reviews).toBeTruthy();
  });

  it('mock connector claims every capability', () => {
    const mock = getCapabilities('mock');
    expect(mock.supported.length).toBeGreaterThanOrEqual(16);
  });
});
