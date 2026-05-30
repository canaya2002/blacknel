import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import type { NormalizedPostInsights } from './base/normalized';
import type { ConnectorAccount } from './base/types';
import { getConnector } from './registry';
import { readAccountTokens } from './tokens';

/**
 * Server-only post-insights dispatch (C52): real-vs-mock routing for fetching a
 * published post's engagement, kept out of the client-reachable registry (same
 * pattern as reviews-dispatch / publish-dispatch). facebook/instagram +
 * isRealMetaEnabled → real Meta Graph; otherwise the connector's mock
 * fetchPostInsights. Returns null when the platform can't provide insights (no
 * token, capability unsupported) so the sync skips that target.
 */
export async function fetchPostInsightsForTarget(
  account: ConnectorAccount,
  externalPostId: string,
): Promise<NormalizedPostInsights | null> {
  if (account.platform === 'facebook' || account.platform === 'instagram') {
    const { isRealMetaEnabled } = await import('./meta/config');
    if (await isRealMetaEnabled()) {
      const tokens = await dbAsOrg(account.organizationId, (tx) =>
        readAccountTokens(tx, account.id),
      );
      if (!tokens?.accessToken) return null;
      const { fetchMetaPostInsights } = await import('./meta/post-insights');
      return fetchMetaPostInsights(account.platform, externalPostId, tokens.accessToken);
    }
  }
  const connector = getConnector(account.platform);
  if (typeof connector.fetchPostInsights !== 'function') return null;
  try {
    return await connector.fetchPostInsights(account, externalPostId);
  } catch {
    // Platform doesn't declare read_insights → skip rather than fail the sweep.
    return null;
  }
}
