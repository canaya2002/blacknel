import 'server-only';

import { adsHttpJson } from '@/lib/ads-connectors/ads-http';
import { isRealGoogleAdsEnabled } from '@/lib/ads-connectors/config';
import { env } from '@/lib/env';

/**
 * Google Ads OAuth (C51) — reuses the Google OAuth2 mechanics (same as
 * YouTube/GBP) with the `adwords` scope + `access_type=offline` so we get a
 * refresh_token. Token exchange goes through the ads-http seam (no network in
 * CI). Mock when `use_real_google_ads` is off. The Google Ads developer token is
 * a header on the API calls (see google-real), NOT part of OAuth.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/adwords';

export interface AdsTokenResult {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

export function buildGoogleAdsAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.GOOGLE_ADS_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleAdsCode(
  code: string,
  redirectUri: string,
): Promise<AdsTokenResult> {
  if (!(await isRealGoogleAdsEnabled())) {
    return { accessToken: `mock-google-ads-token-${code.slice(0, 6) || 'dev'}`, refreshToken: null, expiresAt: null };
  }
  const r = await adsHttpJson<{ access_token: string; refresh_token?: string; expires_in?: number }>({
    method: 'POST',
    url: TOKEN_URL,
    form: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.GOOGLE_ADS_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET ?? '',
    },
  });
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? null,
    expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
  };
}

export async function refreshGoogleAdsToken(refreshToken: string | undefined): Promise<AdsTokenResult> {
  if (!(await isRealGoogleAdsEnabled())) {
    return { accessToken: 'mock-google-ads-token-refreshed', refreshToken: refreshToken ?? null, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
  }
  if (!refreshToken) throw new Error('Google Ads: no refresh_token stored to refresh.');
  const r = await adsHttpJson<{ access_token: string; expires_in?: number }>({
    method: 'POST',
    url: TOKEN_URL,
    form: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: env.GOOGLE_ADS_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET ?? '',
    },
  });
  return {
    accessToken: r.access_token,
    refreshToken,
    expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
  };
}
