import { afterEach, describe, expect, it } from 'vitest';

import { _setGraphFetchForTests } from '../../lib/connectors/meta/graph';
import { fetchMetaMentions } from '../../lib/connectors/meta/mentions';

/**
 * C53 real Meta @mention/tag mapping via the graph fetch seam (zero network).
 * FB = posts where the Page is tagged (/{page}/tagged); IG = media where the
 * business is @mentioned (/{ig}/tags).
 */

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchMetaMentions', () => {
  afterEach(() => _setGraphFetchForTests(null));

  it('maps facebook /tagged posts → NormalizedMention', async () => {
    let seenPath = '';
    _setGraphFetchForTests(async (input) => {
      seenPath = new URL(String(input)).pathname;
      return json({
        data: [
          {
            id: 'fb_m1',
            message: 'Loved this place!',
            from: { id: 'u1', name: 'Jane Doe' },
            permalink_url: 'https://fb.com/p/1',
            created_time: '2026-05-20T10:00:00+0000',
          },
        ],
      });
    });
    const r = await fetchMetaMentions('facebook', 'page-123', 'tok');
    expect(seenPath).toContain('/page-123/tagged');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      platform: 'facebook',
      externalId: 'fb_m1',
      body: 'Loved this place!',
      url: 'https://fb.com/p/1',
    });
    expect(r[0]?.author.displayName).toBe('Jane Doe');
  });

  it('maps instagram /tags media → NormalizedMention', async () => {
    let seenPath = '';
    _setGraphFetchForTests(async (input) => {
      seenPath = new URL(String(input)).pathname;
      return json({
        data: [
          { id: 'ig_m1', caption: 'great service', username: 'foodie_jane', permalink: 'https://ig.com/p/1', timestamp: '2026-05-21T12:00:00+0000' },
        ],
      });
    });
    const r = await fetchMetaMentions('instagram', 'ig-999', 'tok');
    expect(seenPath).toContain('/ig-999/tags');
    expect(r[0]).toMatchObject({
      platform: 'instagram',
      externalId: 'ig_m1',
      body: 'great service',
      url: 'https://ig.com/p/1',
    });
    expect(r[0]?.author.handle).toBe('foodie_jane');
  });

  it('tolerates empty data', async () => {
    _setGraphFetchForTests(async () => json({}));
    expect(await fetchMetaMentions('facebook', 'p', 'tok')).toEqual([]);
  });
});
