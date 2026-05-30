import 'server-only';

import { metaCredsPresent } from '@/lib/connectors/meta/config';
import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';

/**
 * Ads real-vs-mock gating (C50/C51). Each platform's real API path serves ONLY
 * when its creds are present AND `use_real_<platform>_ads='on'` (read fresh per
 * call → operator rollback with `pnpm db:flag … off` lands within one request).
 * Fail-safe to mock on any flag-read error.
 */

/** Meta reuses the content connector's app creds — ads scopes ride the same consent. */
export async function isRealMetaAdsEnabled(): Promise<boolean> {
  if (!metaCredsPresent()) return false;
  return isFlagOn('use_real_meta_ads');
}

/** Google Ads needs its OAuth client + the mandatory developer token. */
export function googleAdsCredsPresent(): boolean {
  return Boolean(
    env.GOOGLE_ADS_CLIENT_ID &&
      env.GOOGLE_ADS_CLIENT_SECRET &&
      env.GOOGLE_ADS_DEVELOPER_TOKEN,
  );
}

export async function isRealGoogleAdsEnabled(): Promise<boolean> {
  if (!googleAdsCredsPresent()) return false;
  return isFlagOn('use_real_google_ads');
}

/** TikTok Ads needs the Marketing API app id + secret. */
export function tiktokAdsCredsPresent(): boolean {
  return Boolean(env.TIKTOK_ADS_APP_ID && env.TIKTOK_ADS_SECRET);
}

export async function isRealTiktokAdsEnabled(): Promise<boolean> {
  if (!tiktokAdsCredsPresent()) return false;
  return isFlagOn('use_real_tiktok_ads');
}
