import 'server-only';

import { isRealGoogleAdsEnabled, isRealTiktokAdsEnabled } from '@/lib/ads-connectors/config';

import { GOOGLE_ADS_PLATFORM, TIKTOK_ADS_PLATFORM } from '../ads-connection-store';
import { buildGoogleAdsAuthUrl, exchangeGoogleAdsCode } from '../google-ads/oauth';
import { buildTiktokAdsAuthUrl, exchangeTiktokAdsCode } from '../tiktok-ads/oauth';

/**
 * Registry of ad-platform OAuth providers (C51) driving the dedicated
 * `/api/connectors/ads/[provider]/{start,callback}` routes. Kept separate from
 * the social OAuth registry because ads connections use a dedicated, non-seat-
 * gated connection store (ads-connection-store) and their own connection
 * platforms — not the `PlatformCode`-typed generic flow.
 */

export interface AdsTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: string | null;
}

export interface AdsOAuthProviderCfg {
  /** connected_accounts.platform for the persisted connection. */
  readonly connectionPlatform: string;
  readonly displayName: string;
  isReal(): Promise<boolean>;
  buildAuthUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<AdsTokens>;
}

const ADS_OAUTH_PROVIDERS: Record<string, AdsOAuthProviderCfg> = {
  'google-ads': {
    connectionPlatform: GOOGLE_ADS_PLATFORM,
    displayName: 'Google Ads',
    isReal: isRealGoogleAdsEnabled,
    buildAuthUrl: buildGoogleAdsAuthUrl,
    exchange: (code, redirectUri) => exchangeGoogleAdsCode(code, redirectUri),
  },
  'tiktok-ads': {
    connectionPlatform: TIKTOK_ADS_PLATFORM,
    displayName: 'TikTok Ads',
    isReal: isRealTiktokAdsEnabled,
    buildAuthUrl: buildTiktokAdsAuthUrl,
    exchange: async (code) => {
      const r = await exchangeTiktokAdsCode(code);
      return { accessToken: r.accessToken, refreshToken: null, expiresAt: r.expiresAt };
    },
  },
};

export function getAdsOAuthProvider(provider: string): AdsOAuthProviderCfg | null {
  return ADS_OAUTH_PROVIDERS[provider] ?? null;
}
