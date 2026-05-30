import 'server-only';

import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';

/**
 * X (Twitter) connector gating + config (C47). OAuth 2.0 Authorization Code with
 * PKCE (confidential client → Basic auth on the token call).
 *
 * Rate / cost: the X API v2 write endpoints are heavily tiered — Free is
 * effectively read-only / minimal, Basic (~$200/mo) allows modest posting, Pro
 * (~$5000/mo) is production volume. Posting throughput + the media upload limits
 * depend on the org's X subscription, not just our code.
 */

export function xCredsPresent(): boolean {
  return Boolean(env.X_CLIENT_ID && env.X_CLIENT_SECRET);
}

export async function isRealXEnabled(): Promise<boolean> {
  if (!xCredsPresent()) return false;
  return isFlagOn('use_real_x');
}

export const X_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
export const X_API_BASE = 'https://api.twitter.com/2';
export const X_UPLOAD_URL = 'https://upload.twitter.com/1.1/media/upload.json';

export const X_SCOPES: ReadonlyArray<string> = [
  'tweet.read',
  'tweet.write',
  'users.read',
  'media.write',
  'offline.access',
];
