import { describe, expect, it } from 'vitest';

import type { ConnectorAccount } from '../../lib/connectors/base';
import type { HttpFn, HttpReqOpts } from '../../lib/connectors/http';
import { fetchGbpReviews, replyGbpReview } from '../../lib/connectors/gbp/reviews';
import { publishToGbp } from '../../lib/connectors/gbp/publish';

/**
 * C49 GBP API modules (reviews fetch/reply + local post). HTTP injected, zero
 * network. Covers star-rating mapping + skip of unrated rows, the reply PUT, and
 * the local-post POST body.
 */

function account(externalId: string): ConnectorAccount {
  return {
    id: 'acc-1',
    organizationId: 'org-1',
    brandId: null,
    locationId: null,
    platform: 'gbp',
    externalAccountId: externalId,
    displayName: 'Loc',
    handle: null,
    status: 'connected',
  };
}

interface Call {
  url: string;
  method: string;
  json?: unknown;
}

function makeHttp(responder: (c: Call) => { data?: unknown }): { http: HttpFn; calls: Call[] } {
  const calls: Call[] = [];
  const http = (async (opts: HttpReqOpts) => {
    const call: Call = { url: opts.url, method: opts.method, json: opts.json };
    calls.push(call);
    return { data: (responder(call).data ?? {}) as unknown, status: 200, headers: new Headers() };
  }) as HttpFn;
  return { http, calls };
}

describe('fetchGbpReviews', () => {
  it('maps star ratings and skips rows without a usable rating', async () => {
    const { http, calls } = makeHttp(() => ({
      data: {
        reviews: [
          {
            reviewId: 'r1',
            reviewer: { displayName: 'Ana', profilePhotoUrl: 'http://a/p.jpg' },
            starRating: 'FIVE',
            comment: 'Excelente',
            createTime: '2026-01-02T00:00:00Z',
          },
          { reviewId: 'r2', starRating: 'STAR_RATING_UNSPECIFIED', comment: 'meh' },
          { reviewId: 'r3', reviewer: { displayName: 'Beto' }, starRating: 'THREE', comment: 'ok' },
        ],
      },
    }));
    const out = await fetchGbpReviews(account('accounts/a/locations/1'), 'TOKEN', { http });
    expect(out).toHaveLength(2); // r2 dropped (no usable rating)
    expect(out[0]).toMatchObject({ externalId: 'r1', rating: 5, body: 'Excelente' });
    expect(out[0]!.author.displayName).toBe('Ana');
    expect(out[1]).toMatchObject({ externalId: 'r3', rating: 3 });
    expect(calls[0]!.url).toContain('/accounts/a/locations/1/reviews');
  });
});

describe('replyGbpReview', () => {
  it('PUTs the reply comment and returns a reply id', async () => {
    const { http, calls } = makeHttp(() => ({}));
    const res = await replyGbpReview(account('accounts/a/locations/1'), 'rev-9', 'Gracias!', 'TOKEN', { http });
    expect(res.externalId).toBe('rev-9/reply');
    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.url).toContain('/reviews/rev-9/reply');
    expect((calls[0]!.json as { comment: string }).comment).toBe('Gracias!');
  });
});

describe('publishToGbp', () => {
  it('posts a STANDARD local post and returns its name', async () => {
    const { http, calls } = makeHttp((c) =>
      c.url.endsWith('/localPosts') ? { data: { name: 'accounts/a/locations/1/localPosts/lp1' } } : {},
    );
    const res = await publishToGbp(
      account('accounts/a/locations/1'),
      { text: 'Open house Saturday!', link: 'https://blacknel.com' },
      {},
      { loadTokens: async () => ({ accessToken: 'TOKEN' }), http },
    );
    expect(res.externalId).toBe('accounts/a/locations/1/localPosts/lp1');
    const post = calls.find((c) => c.url.endsWith('/localPosts'))!;
    expect((post.json as { topicType: string; summary: string }).topicType).toBe('STANDARD');
    expect((post.json as { summary: string }).summary).toBe('Open house Saturday!');
    expect((post.json as { callToAction?: { url: string } }).callToAction?.url).toBe('https://blacknel.com');
  });

  it('throws TokenExpiredError when no token is stored', async () => {
    const { http } = makeHttp(() => ({}));
    await expect(
      publishToGbp(account('accounts/a/locations/1'), { text: 'x' }, {}, { loadTokens: async () => null, http }),
    ).rejects.toBeInstanceOf(Error);
  });
});
