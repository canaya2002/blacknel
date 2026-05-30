import { describe, expect, it } from 'vitest';

import type { ConnectorAccount } from '../../lib/connectors/base';
import type { HttpFn, HttpReqOpts } from '../../lib/connectors/http';
import { publishToLinkedin } from '../../lib/connectors/linkedin/publish';
import { publishToTiktok } from '../../lib/connectors/tiktok/publish';
import { publishToX } from '../../lib/connectors/x/publish';
import { publishToYoutube } from '../../lib/connectors/youtube/publish';

/**
 * C47 batch-2 publishers (LinkedIn / TikTok / X / YouTube). HTTP + media-fetch +
 * sleep are injected so CI never touches the network. Covers each platform's
 * happy path (correct endpoints/params), media handling, and the not-supported
 * guards (e.g. TikTok requires video, X video unimplemented).
 */

function fakeAccount(platform: ConnectorAccount['platform'], externalId: string): ConnectorAccount {
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
  url: string;
  method: string;
  json?: unknown;
  form?: Record<string, unknown>;
}

function makeHttp(
  responder: (call: Call) => { data?: unknown; headers?: Record<string, string> },
): { http: HttpFn; calls: Call[] } {
  const calls: Call[] = [];
  const http = (async (opts: HttpReqOpts) => {
    const call: Call = { url: opts.url, method: opts.method, json: opts.json, form: opts.form };
    calls.push(call);
    const r = responder(call);
    return { data: (r.data ?? {}) as unknown, status: 200, headers: new Headers(r.headers ?? {}) };
  }) as HttpFn;
  return { http, calls };
}

const TOKENS = { loadTokens: async () => ({ accessToken: 'TOKEN' }) };
const FETCH_MEDIA = { fetchMedia: async () => new Uint8Array([1, 2, 3]) };

describe('LinkedIn publisher', () => {
  it('text post → /posts with author + commentary, id from x-restli-id', async () => {
    const { http, calls } = makeHttp((c) =>
      c.url.endsWith('/posts') ? { headers: { 'x-restli-id': 'urn:li:share:1' } } : {},
    );
    const res = await publishToLinkedin(
      fakeAccount('linkedin', 'urn:li:person:abc'),
      { text: 'hola' },
      {},
      { ...TOKENS, ...FETCH_MEDIA, http },
    );
    expect(res.externalId).toBe('urn:li:share:1');
    const post = calls.find((c) => c.url.endsWith('/posts'))!;
    expect((post.json as { author: string }).author).toBe('urn:li:person:abc');
    expect((post.json as { commentary: string }).commentary).toBe('hola');
  });

  it('article link post sets content.article.source', async () => {
    const { http, calls } = makeHttp((c) =>
      c.url.endsWith('/posts') ? { headers: { 'x-restli-id': 'urn:li:share:2' } } : {},
    );
    await publishToLinkedin(
      fakeAccount('linkedin', 'urn:li:organization:9'),
      { text: 'see', link: 'https://blacknel.com' },
      {},
      { ...TOKENS, ...FETCH_MEDIA, http },
    );
    const post = calls.find((c) => c.url.endsWith('/posts'))!;
    expect((post.json as { content: { article: { source: string } } }).content.article.source).toBe(
      'https://blacknel.com',
    );
  });

  it('single image uploads + references the image urn', async () => {
    const { http, calls } = makeHttp((c) => {
      if (c.url.includes('/images?action=initializeUpload')) {
        return { data: { value: { uploadUrl: 'https://up', image: 'urn:li:image:1' } } };
      }
      if (c.url.endsWith('/posts')) return { headers: { 'x-restli-id': 'urn:li:share:3' } };
      return {};
    });
    const res = await publishToLinkedin(
      fakeAccount('linkedin', 'urn:li:person:abc'),
      { text: 'pic', mediaUrls: ['https://cdn/a.jpg'] },
      {},
      { ...TOKENS, ...FETCH_MEDIA, http },
    );
    expect(res.externalId).toBe('urn:li:share:3');
    const post = calls.find((c) => c.url.endsWith('/posts'))!;
    expect((post.json as { content: { media: { id: string } } }).content.media.id).toBe('urn:li:image:1');
    // PUT to the upload URL happened.
    expect(calls.some((c) => c.url === 'https://up' && c.method === 'PUT')).toBe(true);
  });
});

describe('TikTok publisher', () => {
  it('PULL_FROM_URL video init + polls to PUBLISH_COMPLETE', async () => {
    let status = 0;
    const { http, calls } = makeHttp((c) => {
      if (c.url.endsWith('/video/init/')) return { data: { data: { publish_id: 'p1' } } };
      if (c.url.endsWith('/status/fetch/')) {
        status += 1;
        return status >= 2
          ? { data: { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['v1'] } } }
          : { data: { data: { status: 'PROCESSING_DOWNLOAD' } } };
      }
      return {};
    });
    const res = await publishToTiktok(
      fakeAccount('tiktok', 'open-id-1'),
      { text: 'clip', mediaUrls: ['https://cdn/v.mp4'] },
      {},
      { ...TOKENS, http, sleep: async () => {} },
    );
    expect(res.externalId).toBe('v1');
    const init = calls.find((c) => c.url.endsWith('/video/init/'))!;
    expect((init.json as { source_info: { source: string; video_url: string } }).source_info).toEqual({
      source: 'PULL_FROM_URL',
      video_url: 'https://cdn/v.mp4',
    });
    expect(status).toBe(2);
  });

  it('rejects a TikTok post without a video', async () => {
    const { http } = makeHttp(() => ({}));
    await expect(
      publishToTiktok(fakeAccount('tiktok', 'o1'), { text: 'no video' }, {}, { ...TOKENS, http, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('X publisher', () => {
  it('uploads image + posts tweet with media_ids', async () => {
    const { http, calls } = makeHttp((c) => {
      if (c.url.includes('upload.twitter.com')) return { data: { media_id_string: 'm1' } };
      if (c.url.endsWith('/tweets')) return { data: { data: { id: 't1' } } };
      return {};
    });
    const res = await publishToX(
      fakeAccount('x', 'x-user-1'),
      { text: 'gm', mediaUrls: ['https://cdn/a.jpg'] },
      {},
      { ...TOKENS, ...FETCH_MEDIA, http },
    );
    expect(res.externalId).toBe('t1');
    const tweet = calls.find((c) => c.url.endsWith('/tweets'))!;
    expect((tweet.json as { media: { media_ids: string[] } }).media.media_ids).toEqual(['m1']);
  });

  it('text-only tweet omits media', async () => {
    const { http, calls } = makeHttp((c) =>
      c.url.endsWith('/tweets') ? { data: { data: { id: 't2' } } } : {},
    );
    await publishToX(fakeAccount('x', 'x1'), { text: 'hi' }, {}, { ...TOKENS, ...FETCH_MEDIA, http });
    const tweet = calls.find((c) => c.url.endsWith('/tweets'))!;
    expect((tweet.json as { media?: unknown }).media).toBeUndefined();
  });

  it('rejects X video posting (not implemented)', async () => {
    const { http } = makeHttp(() => ({}));
    await expect(
      publishToX(fakeAccount('x', 'x1'), { text: 'v', mediaUrls: ['https://cdn/v.mp4'] }, {}, { ...TOKENS, ...FETCH_MEDIA, http }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe('YouTube publisher', () => {
  it('resumable init (location header) → PUT bytes → video id', async () => {
    const { http, calls } = makeHttp((c) => {
      if (c.url.includes('uploadType=resumable')) {
        return { headers: { location: 'https://upload-session' } };
      }
      if (c.url === 'https://upload-session') return { data: { id: 'yt1' } };
      return {};
    });
    const res = await publishToYoutube(
      fakeAccount('youtube', 'chan-1'),
      { text: 'My Title\nlong description', mediaUrls: ['https://cdn/v.mp4'] },
      {},
      { ...TOKENS, ...FETCH_MEDIA, http },
    );
    expect(res.externalId).toBe('yt1');
    const init = calls.find((c) => c.url.includes('uploadType=resumable'))!;
    expect((init.json as { snippet: { title: string } }).snippet.title).toBe('My Title');
    expect(calls.some((c) => c.url === 'https://upload-session' && c.method === 'PUT')).toBe(true);
  });

  it('rejects a YouTube post without a video', async () => {
    const { http } = makeHttp(() => ({}));
    await expect(
      publishToYoutube(fakeAccount('youtube', 'c1'), { text: 'no video' }, {}, { ...TOKENS, ...FETCH_MEDIA, http }),
    ).rejects.toBeInstanceOf(Error);
  });
});
