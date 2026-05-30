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
  if (account.platform === 'facebook' || account.platform === 'instagram') {
    const { isRealMetaEnabled } = await import('./meta/config');
    if (await isRealMetaEnabled()) {
      const { publishToMeta } = await import('./meta/publish');
      return publishToMeta(account, draft, options);
    }
  }
  if (typeof connector.publishPost !== 'function') {
    throw new Error(`Connector ${account.platform} does not support publishPost.`);
  }
  return connector.publishPost(account, draft, options);
}
