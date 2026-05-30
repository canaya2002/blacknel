import 'server-only';

import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';

/**
 * Google Business Profile (GBP) connector gating + config (C49). Google OAuth
 * (same provider as YouTube) but a DIFFERENT app/creds so the consent dialog only
 * asks for `business.manage` (not YouTube's upload scope). Real path serves only
 * when GBP creds are set AND use_real_gbp='on' (fail-safe to mock).
 */

export function gbpCredsPresent(): boolean {
  return Boolean(env.GBP_CLIENT_ID && env.GBP_CLIENT_SECRET);
}

export async function isRealGbpEnabled(): Promise<boolean> {
  if (!gbpCredsPresent()) return false;
  return isFlagOn('use_real_gbp');
}

export const GBP_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GBP_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Account + location management (discover locations). */
export const GBP_ACCOUNT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1';
export const GBP_INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1';
/** Reviews + local posts live on the v4 endpoint. */
export const GBP_API = 'https://mybusiness.googleapis.com/v4';

export const GBP_SCOPES: ReadonlyArray<string> = [
  'https://www.googleapis.com/auth/business.manage',
  'openid',
  'email',
];
