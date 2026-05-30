import 'server-only';

import { PlatformError, RateLimitedError, TokenExpiredError } from '../base/errors';
import type { PlatformCode } from '../base/types';

import { graphBaseUrl } from './config';

/**
 * Thin Meta Graph API client (C46). Used by the OAuth exchange + the real
 * publisher. Maps Graph error bodies to the connector error taxonomy so the
 * publish-job's retry logic + the UI reconnect prompts work uniformly:
 *
 *   - code 190 (OAuthException) → TokenExpiredError (triggers reconnect/refresh)
 *   - codes 4/17/32/613 (throttling) → RateLimitedError (transient, backoff)
 *   - everything else → PlatformError
 *
 * A fetch seam (`_setGraphFetchForTests`) lets tests inject responses — CI never
 * touches the network. Only invoked on the real path (useRealMeta()).
 */

export interface GraphError {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 341, 613]);

type Fetcher = typeof fetch;
let fetchImpl: Fetcher | null = null;

/** Test seam — inject a fetch returning canned Graph responses (no network). */
export function _setGraphFetchForTests(f: Fetcher | null): void {
  fetchImpl = f;
}

function getFetch(): Fetcher {
  return fetchImpl ?? fetch;
}

function mapGraphError(platform: PlatformCode, err: GraphError | undefined, status: number): never {
  const message = err?.message ?? `Graph API error (HTTP ${status}).`;
  const code = err?.code;
  if (code === 190) {
    throw new TokenExpiredError(platform, { cause: err });
  }
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    throw new RateLimitedError(platform, 60_000, { cause: err });
  }
  throw new PlatformError(platform, message, { cause: err });
}

export interface GraphRequestOpts {
  method: 'GET' | 'POST';
  /** Path after the version base, e.g. '/me/accounts' or '/{pageId}/feed'. */
  path: string;
  /** Query (GET) or form-body (POST) params. `access_token` goes here. */
  params?: Record<string, string | number | boolean | undefined>;
  /** For error tagging only. */
  platform?: PlatformCode;
}

export async function graphRequest<T>(opts: GraphRequestOpts): Promise<T> {
  const platform = opts.platform ?? 'facebook';
  const base = `${graphBaseUrl()}${opts.path}`;
  const entries = Object.entries(opts.params ?? {}).filter(([, v]) => v !== undefined);

  let url = base;
  let body: BodyInit | undefined;
  const headers: Record<string, string> = {};

  if (opts.method === 'GET') {
    const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
    url = qs.toString() ? `${base}?${qs.toString()}` : base;
  } else {
    const form = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
    body = form.toString();
    headers['content-type'] = 'application/x-www-form-urlencoded';
  }

  let res: Response;
  try {
    res = await getFetch()(url, { method: opts.method, ...(body ? { body } : {}), headers });
  } catch (cause) {
    throw new PlatformError(platform, 'Graph API request failed (network).', { cause });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok || (json && typeof json === 'object' && 'error' in json)) {
    const err = (json as { error?: GraphError } | null)?.error;
    mapGraphError(platform, err, res.status);
  }
  return json as T;
}
