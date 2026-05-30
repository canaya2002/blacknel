import 'server-only';

import { adsHttpJson } from '@/lib/ads-connectors/ads-http';
import { isRealTiktokAdsEnabled } from '@/lib/ads-connectors/config';
import { env } from '@/lib/env';

/**
 * TikTok Ads OAuth (C51) — TikTok for Business / Marketing API. The portal auth
 * dialog returns an `auth_code`, exchanged for a long-lived advertiser access
 * token (TikTok tokens don't use refresh_token; they're long-lived → expiresAt
 * null so the refresh cron skips them). Mock when `use_real_tiktok_ads` is off.
 */

const AUTH_URL = 'https://business-api.tiktok.com/portal/auth';
const TOKEN_URL = 'https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/';

export interface TiktokTokenResult {
  accessToken: string;
  expiresAt: string | null;
}

export function buildTiktokAdsAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    app_id: env.TIKTOK_ADS_APP_ID ?? '',
    state,
    redirect_uri: redirectUri,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeTiktokAdsCode(code: string): Promise<TiktokTokenResult> {
  if (!(await isRealTiktokAdsEnabled())) {
    return { accessToken: `mock-tiktok-ads-token-${code.slice(0, 6) || 'dev'}`, expiresAt: null };
  }
  const r = await adsHttpJson<{ code?: number; message?: string; data?: { access_token?: string } }>({
    method: 'POST',
    url: TOKEN_URL,
    json: {
      app_id: env.TIKTOK_ADS_APP_ID,
      secret: env.TIKTOK_ADS_SECRET,
      auth_code: code,
      grant_type: 'authorization_code',
    },
  });
  if (r.code && r.code !== 0) throw new Error(`TikTok ${r.code}: ${r.message ?? 'oauth error'}`);
  const accessToken = r.data?.access_token;
  if (!accessToken) throw new Error('TikTok Ads: no access_token in exchange response.');
  return { accessToken, expiresAt: null };
}
