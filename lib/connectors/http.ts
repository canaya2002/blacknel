import 'server-only';

import { PlatformError, RateLimitedError, TokenExpiredError } from './base/errors';
import type { PlatformCode } from './base/types';

/**
 * Shared HTTP client for connector OAuth + publish calls (C47). One place for
 * request shaping (form / json / raw body) + mapping HTTP status to the connector
 * error taxonomy so every platform's retry/reconnect behavior is uniform:
 *
 *   - 401 / 403 → TokenExpiredError (reconnect / refresh)
 *   - 429       → RateLimitedError (transient backoff)
 *   - else      → PlatformError
 *
 * Publishers inject `deps.http` (a fake) in tests — no network in CI. The OAuth
 * real branches call httpJson directly (mock branch avoids HTTP entirely).
 */

export interface HttpReqOpts {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  /** application/x-www-form-urlencoded body. */
  form?: Record<string, string | number | boolean | undefined>;
  /** application/json body. */
  json?: unknown;
  /** Raw body (e.g. binary upload). Not combined with form/json. */
  body?: BodyInit | Uint8Array;
  platform: PlatformCode;
}

export interface HttpResult<T> {
  readonly data: T;
  readonly status: number;
  readonly headers: Headers;
}

/** Publisher HTTP fn — returns headers too (some APIs return the new id there). */
export type HttpFn = <T>(opts: HttpReqOpts) => Promise<HttpResult<T>>;

let fetchImpl: typeof fetch | null = null;

/** Test seam — inject a fetch returning canned responses (no network). */
export function _setConnectorFetchForTests(f: typeof fetch | null): void {
  fetchImpl = f;
}

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.message === 'string') return b.message;
  if (typeof b.error === 'string') return b.error;
  if (b.error && typeof b.error === 'object') {
    const e = b.error as Record<string, unknown>;
    if (typeof e.message === 'string') return e.message;
  }
  if (typeof b.error_description === 'string') return b.error_description;
  if (typeof b.title === 'string') return b.title;
  return null;
}

export function mapConnectorHttpError(platform: PlatformCode, status: number, body: unknown): never {
  const message = extractMessage(body) ?? `HTTP ${status}`;
  if (status === 401 || status === 403) {
    throw new TokenExpiredError(platform, { cause: body });
  }
  if (status === 429) {
    throw new RateLimitedError(platform, 60_000, { cause: body });
  }
  throw new PlatformError(platform, message, { cause: body });
}

/** Fetch raw media bytes (e.g. an R2 URL) for platforms that upload binaries. */
export type FetchBytesFn = (url: string) => Promise<Uint8Array>;

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`media fetch failed: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function httpRequest<T>(opts: HttpReqOpts): Promise<HttpResult<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.form) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) {
      if (v !== undefined) params.set(k, String(v));
    }
    body = params.toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  } else if (opts.json !== undefined) {
    body = JSON.stringify(opts.json);
    headers['content-type'] = 'application/json';
  } else if (opts.body !== undefined) {
    body = opts.body as BodyInit;
  }

  const doFetch = fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(opts.url, {
      method: opts.method,
      ...(body !== undefined ? { body } : {}),
      headers,
    });
  } catch (cause) {
    throw new PlatformError(opts.platform, 'HTTP request failed (network).', { cause });
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    mapConnectorHttpError(opts.platform, res.status, json);
  }
  return { data: json as T, status: res.status, headers: res.headers };
}

/** JSON-body convenience (OAuth token/exchange calls that don't need headers). */
export async function httpJson<T>(opts: HttpReqOpts): Promise<T> {
  return (await httpRequest<T>(opts)).data;
}
