import { PLATFORMS, type Connector, type ConnectorCapabilities, type PlatformCode } from './base';

import { buildAvvoConnector } from './avvo';
import { buildBbbConnector } from './bbb';
import { buildFacebookConnector } from './facebook';
import { buildGbpConnector } from './gbp';
import { buildInstagramConnector } from './instagram';
import { buildLinkedinConnector } from './linkedin';
import { buildMockConnector } from './mock';
import { buildPinterestConnector } from './pinterest';
import { buildRedditConnector } from './reddit';
import { buildTiktokConnector } from './tiktok';
import { buildTripadvisorConnector } from './tripadvisor';
import { buildTrustpilotConnector } from './trustpilot';
import { buildWhatsappConnector } from './whatsapp';
import { buildXConnector } from './x';
import { buildYelpConnector } from './yelp';
import { buildYoutubeConnector } from './youtube';

import { AVVO_CAPABILITIES } from './avvo/capabilities';
import { BBB_CAPABILITIES } from './bbb/capabilities';
import { FACEBOOK_CAPABILITIES } from './facebook/capabilities';
import { GBP_CAPABILITIES } from './gbp/capabilities';
import { INSTAGRAM_CAPABILITIES } from './instagram/capabilities';
import { LINKEDIN_CAPABILITIES } from './linkedin/capabilities';
import { MOCK_CAPABILITIES } from './mock/capabilities';
import { PINTEREST_CAPABILITIES } from './pinterest/capabilities';
import { REDDIT_CAPABILITIES } from './reddit/capabilities';
import { TIKTOK_CAPABILITIES } from './tiktok/capabilities';
import { TRIPADVISOR_CAPABILITIES } from './tripadvisor/capabilities';
import { TRUSTPILOT_CAPABILITIES } from './trustpilot/capabilities';
import { WHATSAPP_CAPABILITIES } from './whatsapp/capabilities';
import { X_CAPABILITIES } from './x/capabilities';
import { YELP_CAPABILITIES } from './yelp/capabilities';
import { YOUTUBE_CAPABILITIES } from './youtube/capabilities';

import { PLANS, type PlanCode } from '@/lib/plans/plans';
import { planAllowsPlatform } from '@/lib/plans/gating';

/**
 * Built-once-per-process registry. Each platform's `build*Connector`
 * factory reads env to decide error simulation; we instantiate once at
 * module import so the same instance handles every request — important
 * for the deterministic seed math in `MockConnector`.
 */
const REGISTRY: Record<PlatformCode, Connector> = {
  facebook: buildFacebookConnector(),
  instagram: buildInstagramConnector(),
  gbp: buildGbpConnector(),
  whatsapp: buildWhatsappConnector(),
  tiktok: buildTiktokConnector(),
  linkedin: buildLinkedinConnector(),
  x: buildXConnector(),
  youtube: buildYoutubeConnector(),
  pinterest: buildPinterestConnector(),
  reddit: buildRedditConnector(),
  yelp: buildYelpConnector(),
  tripadvisor: buildTripadvisorConnector(),
  trustpilot: buildTrustpilotConnector(),
  bbb: buildBbbConnector(),
  avvo: buildAvvoConnector(),
  mock: buildMockConnector(),
};

const CAPABILITIES_BY_PLATFORM: Record<PlatformCode, ConnectorCapabilities> = {
  facebook: FACEBOOK_CAPABILITIES,
  instagram: INSTAGRAM_CAPABILITIES,
  gbp: GBP_CAPABILITIES,
  whatsapp: WHATSAPP_CAPABILITIES,
  tiktok: TIKTOK_CAPABILITIES,
  linkedin: LINKEDIN_CAPABILITIES,
  x: X_CAPABILITIES,
  youtube: YOUTUBE_CAPABILITIES,
  pinterest: PINTEREST_CAPABILITIES,
  reddit: REDDIT_CAPABILITIES,
  yelp: YELP_CAPABILITIES,
  tripadvisor: TRIPADVISOR_CAPABILITIES,
  trustpilot: TRUSTPILOT_CAPABILITIES,
  bbb: BBB_CAPABILITIES,
  avvo: AVVO_CAPABILITIES,
  mock: MOCK_CAPABILITIES,
};

export function getConnector(platform: PlatformCode): Connector {
  const c = REGISTRY[platform];
  if (!c) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return c;
}

/** Returns the declared capability set without invoking the connector. */
export function getCapabilities(platform: PlatformCode): ConnectorCapabilities {
  return CAPABILITIES_BY_PLATFORM[platform];
}

export interface PlanConnectorEntry {
  platform: PlatformCode;
  available: boolean;
  gatedBy: PlanCode | null;
  capabilities: ConnectorCapabilities;
}

/**
 * Snapshot of every platform for a plan: which are usable, which are
 * paywalled and at what tier. Drives the /integrations grid + the
 * plan-feature gating in `lib/plans/gating.ts`.
 */
export function listConnectorsForPlan(plan: PlanCode): ReadonlyArray<PlanConnectorEntry> {
  return PLATFORMS.filter((p) => p !== 'mock').map((platform) => {
    const available = planAllowsPlatform(plan, platform);
    let gatedBy: PlanCode | null = null;
    if (!available) {
      // Find lowest plan that contains the platform.
      for (const code of ['standard', 'growth', 'enterprise'] as PlanCode[]) {
        if (planAllowsPlatform(code, platform)) {
          gatedBy = code;
          break;
        }
      }
      // Defensive: anything not found at any tier shouldn't happen, but
      // surface as enterprise rather than crashing the grid.
      if (!gatedBy) gatedBy = 'enterprise';
    }
    return {
      platform,
      available,
      gatedBy,
      capabilities: CAPABILITIES_BY_PLATFORM[platform],
    };
  });
}

// Touch PLANS so a future PR that drops it from `lib/plans/plans.ts`
// doesn't silently break this map.
void PLANS;
