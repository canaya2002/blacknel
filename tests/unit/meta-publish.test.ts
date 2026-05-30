import { describe, expect, it, vi } from 'vitest';

import { RateLimitedError, TokenExpiredError } from '../../lib/connectors/base/errors';
import type { Connector, ConnectorAccount } from '../../lib/connectors/base';
import { _setGraphFetchForTests, graphRequest } from '../../lib/connectors/meta/graph';
import { _setSleepForTests, publishToMeta, type MetaPublishDeps } from '../../lib/connectors/meta/publish';
import { publishViaConnector } from '../../lib/connectors/publish-dispatch';

/**
 * C46 Meta publisher (P1). Graph is injected (deps.graph) so CI never hits the
 * network. Covers FB feed/photo/multi-photo/video, the IG container flow
 * (single + carousel), the IG "requires media" guard, the missing-token guard,
 * and the graph error → connector-error taxonomy mapping.
 */

function fakeAccount(platform: 'facebook' | 'instagram', externalId: string): ConnectorAccount {
  return {
    id: 'acc-1',
    organizationId: 'org-1',
    brandId: null,
    locationId: null,
    platform,
    externalAccountId: externalId,
    displayName: 'X',
    handle: null,
    status: 'connected',
  };
}

interface Call {
  path: string;
  params: Record<string, unknown>;
}

/** Build deps with a graph stub that records calls + returns by path/params. */
function makeDeps(
  responder: (call: Call) => Record<string, unknown>,
  tokens: { accessToken: string } | null = { accessToken: 'PAGE_TOKEN' },
): { deps: MetaPublishDeps; calls: Call[] } {
  const calls: Call[] = [];
  const graph = (async (opts: { path: string; params?: Record<string, unknown> }) => {
    const call: Call = { path: opts.path, params: opts.params ?? {} };
    calls.push(call);
    return responder(call);
  }) as unknown as typeof graphRequest;
  return { deps: { loadTokens: async () => tokens, graph }, calls };
}

describe('publishToMeta — Facebook', () => {
  it('no media → /feed with message', async () => {
    const { deps, calls } = makeDeps(() => ({ id: 'fb_feed_1' }));
    const res = await publishToMeta(fakeAccount('facebook', 'PAGE'), { text: 'hello' }, {}, deps);
    expect(res.externalId).toBe('fb_feed_1');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/PAGE/feed');
    expect(calls[0]!.params.message).toBe('hello');
    expect(calls[0]!.params.access_token).toBe('PAGE_TOKEN');
  });

  it('single image → /photos, returns post_id', async () => {
    const { deps, calls } = makeDeps(() => ({ id: 'ph1', post_id: 'fb_post_99' }));
    const res = await publishToMeta(
      fakeAccount('facebook', 'PAGE'),
      { text: 'cap', mediaUrls: ['https://cdn/x.jpg'] },
      {},
      deps,
    );
    expect(res.externalId).toBe('fb_post_99');
    expect(calls[0]!.path).toBe('/PAGE/photos');
    expect(calls[0]!.params.url).toBe('https://cdn/x.jpg');
    expect(calls[0]!.params.caption).toBe('cap');
  });

  it('single video → /videos', async () => {
    const { deps, calls } = makeDeps(() => ({ id: 'fb_vid_1' }));
    const res = await publishToMeta(
      fakeAccount('facebook', 'PAGE'),
      { text: 'v', mediaUrls: ['https://cdn/clip.mp4'] },
      {},
      deps,
    );
    expect(res.externalId).toBe('fb_vid_1');
    expect(calls[0]!.path).toBe('/PAGE/videos');
    expect(calls[0]!.params.file_url).toBe('https://cdn/clip.mp4');
  });

  it('multi image → unpublished photos then /feed with attached_media', async () => {
    let n = 0;
    const { deps, calls } = makeDeps((c) =>
      c.path.endsWith('/feed') ? { id: 'fb_feed_multi' } : { id: `ph${++n}` },
    );
    const res = await publishToMeta(
      fakeAccount('facebook', 'PAGE'),
      { text: 'gallery', mediaUrls: ['https://cdn/a.jpg', 'https://cdn/b.jpg'] },
      {},
      deps,
    );
    expect(res.externalId).toBe('fb_feed_multi');
    // 2 photo uploads (published:false) + 1 feed.
    expect(calls.filter((c) => c.path === '/PAGE/photos')).toHaveLength(2);
    expect(calls.every((c) => (c.path === '/PAGE/photos' ? c.params.published === false : true))).toBe(true);
    const feed = calls.find((c) => c.path === '/PAGE/feed')!;
    expect(feed.params['attached_media[0]']).toContain('ph1');
    expect(feed.params['attached_media[1]']).toContain('ph2');
  });
});

describe('publishToMeta — Instagram', () => {
  it('single image → container then media_publish', async () => {
    const { deps, calls } = makeDeps((c) =>
      c.path.endsWith('/media_publish') ? { id: 'ig_pub_1' } : { id: 'creation_1' },
    );
    const res = await publishToMeta(
      fakeAccount('instagram', 'IG'),
      { text: 'caption', mediaUrls: ['https://cdn/p.jpg'] },
      {},
      deps,
    );
    expect(res.externalId).toBe('ig_pub_1');
    expect(calls[0]!.path).toBe('/IG/media');
    expect(calls[0]!.params.image_url).toBe('https://cdn/p.jpg');
    expect(calls[1]!.path).toBe('/IG/media_publish');
    expect(calls[1]!.params.creation_id).toBe('creation_1');
  });

  it('carousel → per-child containers + CAROUSEL parent + publish', async () => {
    let child = 0;
    const { deps, calls } = makeDeps((c) => {
      if (c.path.endsWith('/media_publish')) return { id: 'ig_pub_carousel' };
      if (c.params.media_type === 'CAROUSEL') return { id: 'parent_1' };
      return { id: `child_${++child}` };
    });
    const res = await publishToMeta(
      fakeAccount('instagram', 'IG'),
      { text: 'c', mediaUrls: ['https://cdn/1.jpg', 'https://cdn/2.jpg'] },
      {},
      deps,
    );
    expect(res.externalId).toBe('ig_pub_carousel');
    const children = calls.filter((c) => c.params.is_carousel_item === 'true');
    expect(children).toHaveLength(2);
    const parent = calls.find((c) => c.params.media_type === 'CAROUSEL')!;
    expect(parent.params.children).toBe('child_1,child_2');
  });

  it('rejects an IG post with no media', async () => {
    const { deps } = makeDeps(() => ({ id: 'x' }));
    await expect(
      publishToMeta(fakeAccount('instagram', 'IG'), { text: 'no media' }, {}, deps),
    ).rejects.toBeInstanceOf(Error);
  });

  it('polls a REELS/video container until FINISHED before media_publish', async () => {
    _setSleepForTests(async () => {}); // no real waiting
    let statusChecks = 0;
    const { deps, calls } = makeDeps((c) => {
      if (c.path === '/IG/media') return { id: 'creation_reel' };
      if (c.path === '/creation_reel') {
        statusChecks += 1;
        return { status_code: statusChecks >= 2 ? 'FINISHED' : 'IN_PROGRESS' };
      }
      if (c.path.endsWith('/media_publish')) return { id: 'ig_reel_pub' };
      return { id: 'x' };
    });
    const res = await publishToMeta(
      fakeAccount('instagram', 'IG'),
      { text: 'reel', mediaUrls: ['https://cdn/clip.mp4'] },
      {},
      deps,
    );
    expect(res.externalId).toBe('ig_reel_pub');
    // Container created as REELS, polled (2 status checks: IN_PROGRESS→FINISHED),
    // then published.
    expect(calls[0]!.params.media_type).toBe('REELS');
    expect(calls[0]!.params.video_url).toBe('https://cdn/clip.mp4');
    expect(statusChecks).toBe(2);
    expect(calls[calls.length - 1]!.path).toBe('/IG/media_publish');
    _setSleepForTests(null);
  });
});

describe('publishViaConnector — dispatch seam gating', () => {
  it('routes to the connector mock path when real Meta is disabled (no creds)', async () => {
    // In tests META_* creds are absent → isRealMetaEnabled() is false → the seam
    // delegates to the connector (mock), never the real Graph publisher.
    const publishPost = vi.fn(async () => ({ externalId: 'mock-fb-123' }));
    const connector = { platform: 'facebook', publishPost } as unknown as Connector;
    const res = await publishViaConnector(
      connector,
      fakeAccount('facebook', 'PAGE'),
      { text: 'hi' },
      { idempotencyKey: 'k1' },
    );
    expect(res.externalId).toBe('mock-fb-123');
    expect(publishPost).toHaveBeenCalledTimes(1);
  });
});

describe('publishToMeta — guards', () => {
  it('throws TokenExpiredError when no token is stored', async () => {
    const { deps } = makeDeps(() => ({ id: 'x' }), null);
    await expect(
      publishToMeta(fakeAccount('facebook', 'PAGE'), { text: 'x' }, {}, deps),
    ).rejects.toBeInstanceOf(TokenExpiredError);
  });
});

describe('graph error mapping', () => {
  it('maps code 190 → TokenExpiredError and a throttle code → RateLimitedError', async () => {
    _setGraphFetchForTests(
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 190, message: 'expired' } }), { status: 400 }),
      ) as unknown as typeof fetch,
    );
    await expect(
      graphRequest({ method: 'GET', path: '/me', platform: 'facebook' }),
    ).rejects.toBeInstanceOf(TokenExpiredError);

    _setGraphFetchForTests(
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 4, message: 'rate' } }), { status: 400 }),
      ) as unknown as typeof fetch,
    );
    await expect(
      graphRequest({ method: 'GET', path: '/me', platform: 'facebook' }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    _setGraphFetchForTests(null);
  });
});
