/**
 * Single swap point for the ads-connector layer. `ads-sync.ts`
 * imports `getAdsConnector(platform)` — never a specific mock
 * file. At Phase 11, real connectors land behind a `MOCK_ADS_*`
 * env flag and this function flips its default.
 */

import { type AdsConnector, type AdsConnectorPlatform } from './base';
import { googleMockConnector } from './google-mock';
import { metaMockConnector } from './meta-mock';

export function getAdsConnector(platform: AdsConnectorPlatform): AdsConnector {
  switch (platform) {
    case 'google':
      return googleMockConnector;
    case 'meta':
      return metaMockConnector;
    default: {
      const exhaustive: never = platform;
      throw new Error(`Unsupported ads platform: ${String(exhaustive)}`);
    }
  }
}

export type {
  AdsConnector,
  AdsConnectorAccount,
  AdsConnectorDateRange,
  AdsConnectorPlatform,
  AdsConnectorSpendRow,
} from './base';
