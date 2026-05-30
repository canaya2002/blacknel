import 'server-only';

import { type AdsConnector, type AdsConnectorPlatform } from './base';
import { isRealMetaAdsEnabled } from './config';
import { getAdsConnector } from './index';

/**
 * Server-only real-vs-mock resolution for ads connectors (C50), kept out of the
 * client-reachable `getAdsConnector` factory (same split as publish-dispatch /
 * reviews-dispatch). The real Meta adapter (which pulls in the Graph client) is
 * lazy-imported so it never lands in a client bundle. Google's real connector is
 * a later batch → always mock for now.
 */

export async function isRealAdsEnabled(platform: AdsConnectorPlatform): Promise<boolean> {
  if (platform === 'meta') return isRealMetaAdsEnabled();
  return false;
}

export async function resolveAdsConnector(
  platform: AdsConnectorPlatform,
): Promise<AdsConnector> {
  if (platform === 'meta' && (await isRealMetaAdsEnabled())) {
    const { metaRealConnector } = await import('./meta-real');
    return metaRealConnector;
  }
  return getAdsConnector(platform);
}
