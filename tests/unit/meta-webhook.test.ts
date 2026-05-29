import { type NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  signWebhookBodyForTest,
  validateWebhookSignature,
} from '../../lib/meta/webhook-signature';

const VERIFY_TOKEN = 'test-verify-token-not-real';
const APP_SECRET = 'test-app-secret-not-real';

// Mock env BEFORE importing the route module — the handlers close over
// `env.META_WEBHOOK_VERIFY_TOKEN` and `env.META_APP_SECRET` at import.
vi.mock('@/lib/env', () => ({
  env: {
    META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
    META_APP_SECRET: APP_SECRET,
  },
}));

// dbAdmin is called for the POST persistence path. The route uses
// `.returning({ id })`, so the mock resolves to a one-row array (a successful
// insert); tests that exercise the dedup path override it to resolve [].
const dbAdminMock = vi.fn(async (..._args: unknown[]) => [{ id: 'evt-1' }] as unknown);
vi.mock('@/lib/db/client', () => ({
  dbAdmin: (...args: unknown[]) => dbAdminMock(...args),
}));

// Import AFTER mocks are registered.
const { GET, POST } = await import('../../app/api/webhooks/meta/route');

beforeEach(() => {
  dbAdminMock.mockClear();
  dbAdminMock.mockImplementation(async () => [{ id: 'evt-1' }]);
});

/**
 * Build a `NextRequest`-shaped object good enough for the route. Next's
 * NextRequest wraps the standard `Request` and exposes `nextUrl`; for
 * unit tests we duck-type with the same surface the handlers touch.
 */
function buildGetRequest(query: Record<string, string>): NextRequest {
  const url = new URL('https://app.example.com/api/webhooks/meta');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new Request(url, { method: 'GET' }) as unknown as {
    nextUrl: URL;
    headers: Headers;
  };
  req.nextUrl = url;
  return req as unknown as NextRequest;
}

function buildPostRequest(
  body: string,
  headers: Record<string, string> = {},
): NextRequest {
  const req = new Request('https://app.example.com/api/webhooks/meta', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', ...headers },
  }) as unknown as NextRequest;
  return req;
}

describe('validateWebhookSignature', () => {
  it('accepts a freshly signed body with the right secret', () => {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const sig = signWebhookBodyForTest(body, APP_SECRET);
    expect(validateWebhookSignature(body, sig, APP_SECRET)).toBe(true);
  });

  it('rejects when the secret differs', () => {
    const body = '{"object":"page"}';
    const sig = signWebhookBodyForTest(body, APP_SECRET);
    expect(validateWebhookSignature(body, sig, 'different-secret')).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const original = '{"object":"page"}';
    const sig = signWebhookBodyForTest(original, APP_SECRET);
    expect(validateWebhookSignature('{"object":"hacked"}', sig, APP_SECRET)).toBe(false);
  });

  it('rejects without the sha256= prefix', () => {
    const body = '{}';
    const hex = signWebhookBodyForTest(body, APP_SECRET).slice('sha256='.length);
    expect(validateWebhookSignature(body, hex, APP_SECRET)).toBe(false);
  });

  it('rejects non-hex signature payloads', () => {
    expect(validateWebhookSignature('{}', 'sha256=not-hex-zzz', APP_SECRET)).toBe(false);
  });

  it('rejects on empty inputs', () => {
    expect(validateWebhookSignature('', 'sha256=00', APP_SECRET)).toBe(false);
    expect(validateWebhookSignature('{}', '', APP_SECRET)).toBe(false);
    expect(validateWebhookSignature('{}', 'sha256=00', '')).toBe(false);
  });
});

describe('GET /api/webhooks/meta', () => {
  it('returns 200 + the challenge body when verify_token matches', async () => {
    const res = await GET(
      buildGetRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'echo-me-1234',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toBe('echo-me-1234');
  });

  it('returns 403 when verify_token is wrong', async () => {
    const res = await GET(
      buildGetRequest({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': 'echo',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 when mode is not "subscribe"', async () => {
    const res = await GET(
      buildGetRequest({
        'hub.mode': 'unsubscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'echo',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when params are missing entirely', async () => {
    const res = await GET(buildGetRequest({}));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/webhooks/meta', () => {
  it('returns 200 + persists when the signature matches', async () => {
    const body = JSON.stringify({ object: 'instagram', entry: [{ id: 'abc' }] });
    const sig = signWebhookBodyForTest(body, APP_SECRET);
    const res = await POST(buildPostRequest(body, { [`x-hub-signature-256`]: sig }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(dbAdminMock).toHaveBeenCalledTimes(1);
  });

  it('returns 401 when signature is wrong', async () => {
    const body = JSON.stringify({ object: 'page' });
    const wrong = signWebhookBodyForTest(body, 'different-secret');
    const res = await POST(buildPostRequest(body, { [`x-hub-signature-256`]: wrong }));
    expect(res.status).toBe(401);
    expect(dbAdminMock).not.toHaveBeenCalled();
  });

  it('returns 401 when signature header is missing', async () => {
    const res = await POST(buildPostRequest('{"object":"page"}'));
    expect(res.status).toBe(401);
    expect(dbAdminMock).not.toHaveBeenCalled();
  });

  it('returns 200 + deduped when the signature already exists (idempotent)', async () => {
    // Simulate the unique-index conflict: ON CONFLICT DO NOTHING → empty RETURNING.
    dbAdminMock.mockImplementationOnce(async () => []);
    const body = JSON.stringify({ object: 'page', entry: [{ id: 'dup' }] });
    const sig = signWebhookBodyForTest(body, APP_SECRET);
    const res = await POST(buildPostRequest(body, { 'x-hub-signature-256': sig }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, deduped: true });
    expect(dbAdminMock).toHaveBeenCalledTimes(1);
  });

  it('returns 200 + skipped for a stale event and does not persist', async () => {
    const stale = Math.floor(Date.now() / 1000) - 3600; // 1h old
    const body = JSON.stringify({ object: 'page', entry: [{ id: 'old', time: stale }] });
    const sig = signWebhookBodyForTest(body, APP_SECRET);
    const res = await POST(buildPostRequest(body, { 'x-hub-signature-256': sig }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, skipped: 'stale' });
    expect(dbAdminMock).not.toHaveBeenCalled();
  });

  it('accepts a fresh event within the window', async () => {
    const fresh = Math.floor(Date.now() / 1000) - 30;
    const body = JSON.stringify({ object: 'page', entry: [{ id: 'new', time: fresh }] });
    const sig = signWebhookBodyForTest(body, APP_SECRET);
    const res = await POST(buildPostRequest(body, { 'x-hub-signature-256': sig }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(dbAdminMock).toHaveBeenCalledTimes(1);
  });
});
