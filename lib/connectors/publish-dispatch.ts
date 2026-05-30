import 'server-only';

import type { Connector, ConnectorAccount } from './base';

/**
 * Server-only publish seam (C46). The connector registry is client-reachable
 * (capabilities render in the composer), so it can't carry the server-only
 * gating + Graph code. This module — imported only by the publish-job
 * (server-only) — decides real-vs-mock for Meta platforms and routes
 * accordingly, keeping the registry/connector graph client-safe.
 *
 *   - facebook / instagram + isRealMetaEnabled() → real Graph publisher.
 *   - otherwise → the connector's own publishPost (mock today).
 *
 * Gating + publisher are lazy-imported so they only load on the server real path.
 */
export async function publishViaConnector(
  connector: Connector,
  account: ConnectorAccount,
  draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  options: { idempotencyKey?: string },
): Promise<{ externalId: string }> {
  // Per-platform real path (gated + lazy-imported so the server-only Graph/OAuth
  // code never enters the client-reachable registry graph). Falls through to the
  // connector mock when the platform's real flag is off.
  const real = await tryRealPublish(account, draft, options);
  if (real) return real;

  if (typeof connector.publishPost !== 'function') {
    throw new Error(`Connector ${account.platform} does not support publishPost.`);
  }
  return connector.publishPost(account, draft, options);
}

async function tryRealPublish(
  account: ConnectorAccount,
  draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  options: { idempotencyKey?: string },
): Promise<{ externalId: string } | null> {
  switch (account.platform) {
    case 'facebook':
    case 'instagram': {
      const { isRealMetaEnabled } = await import('./meta/config');
      if (!(await isRealMetaEnabled())) return null;
      const { publishToMeta } = await import('./meta/publish');
      return publishToMeta(account, draft, options);
    }
    case 'linkedin': {
      const { isRealLinkedinEnabled } = await import('./linkedin/config');
      if (!(await isRealLinkedinEnabled())) return null;
      const { publishToLinkedin } = await import('./linkedin/publish');
      return publishToLinkedin(account, draft, options);
    }
    case 'tiktok': {
      const { isRealTiktokEnabled } = await import('./tiktok/config');
      if (!(await isRealTiktokEnabled())) return null;
      const { publishToTiktok } = await import('./tiktok/publish');
      return publishToTiktok(account, draft, options);
    }
    case 'x': {
      const { isRealXEnabled } = await import('./x/config');
      if (!(await isRealXEnabled())) return null;
      const { publishToX } = await import('./x/publish');
      return publishToX(account, draft, options);
    }
    case 'youtube': {
      const { isRealYoutubeEnabled } = await import('./youtube/config');
      if (!(await isRealYoutubeEnabled())) return null;
      const { publishToYoutube } = await import('./youtube/publish');
      return publishToYoutube(account, draft, options);
    }
    default:
      return null;
  }
}
