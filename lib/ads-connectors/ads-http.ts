import 'server-only';

/**
 * Minimal HTTP client for the real ads adapters (C51), with a fetch seam so the
 * Google Ads + TikTok Marketing API mappings are unit-tested without network.
 * Kept separate from lib/connectors/http.ts because that client's `platform`
 * field is a social `PlatformCode` ('facebook'…'gbp') that doesn't model
 * 'google'/'tiktok' ad platforms — and the ads sync catches errors per-account,
 * so it doesn't need the social error taxonomy (TokenExpired/RateLimited).
 */

type Fetcher = typeof fetch;
let fetchImpl: Fetcher | null = null;

/** Test seam — inject a fetch returning canned responses (no network). */
export function _setAdsFetchForTests(f: Fetcher | null): void {
  fetchImpl = f;
}

function getFetch(): Fetcher {
  return fetchImpl ?? fetch;
}

export interface AdsHttpOpts {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  json?: unknown;
  form?: Record<string, string>;
}

export async function adsHttpJson<T>(opts: AdsHttpOpts): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(opts.form).toString();
  }

  let res: Response;
  try {
    res = await getFetch()(opts.url, {
      method: opts.method,
      ...(body !== undefined ? { body } : {}),
      headers,
    });
  } catch (cause) {
    throw new Error(`ads http request failed: ${(cause as Error).message}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail =
      json && typeof json === 'object' ? JSON.stringify(json).slice(0, 300) : String(json);
    throw new Error(`ads http ${res.status}: ${detail}`);
  }
  return json as T;
}
