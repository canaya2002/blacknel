import 'server-only';

import { type AdsConnector, type AdsConnectorPlatform } from './base';
import {
  isRealGoogleAdsEnabled,
  isRealMetaAdsEnabled,
  isRealTiktokAdsEnabled,
} from './config';
import { getAdsConnector } from './index';

/**
 * Server-only real-vs-mock resolution for ads connectors (C50/C51), kept out of
 * the client-reachable `getAdsConnector` factory (same split as publish-dispatch
 * / reviews-dispatch). The real adapters (which pull in the platform HTTP
 * clients) are lazy-imported so they never land in a client bundle.
 */

export async function isRealAdsEnabled(platform: AdsConnectorPlatform): Promise<boolean> {
  switch (platform) {
    case 'meta':
      return isRealMetaAdsEnabled();
    case 'google':
      return isRealGoogleAdsEnabled();
    case 'tiktok':
      return isRealTiktokAdsEnabled();
    default:
      return false;
  }
}

export async function resolveAdsConnector(
  platform: AdsConnectorPlatform,
): Promise<AdsConnector> {
  if (await isRealAdsEnabled(platform)) {
    switch (platform) {
      case 'meta':
        return (await import('./meta-real')).metaRealConnector;
      case 'google':
        return (await import('./google-real')).googleRealConnector;
      case 'tiktok':
        return (await import('./tiktok-real')).tiktokRealConnector;
    }
  }
  return getAdsConnector(platform);
}
