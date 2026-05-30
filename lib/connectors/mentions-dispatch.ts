import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import type { NormalizedMention } from './base/normalized';
import type { ConnectorAccount } from './base/types';
import { getConnector } from './registry';
import { readAccountTokens } from './tokens';

/**
 * Server-only mentions dispatch (C53): real-vs-mock routing for fetching the
 * @mentions/tags surfaced ON a connected account, kept out of the client-
 * reachable registry (same pattern as reviews/post-insights dispatch).
 * facebook/instagram + isRealListeningEnabled → real Meta Graph; otherwise the
 * connector's mock fetchMentions. Returns [] when the platform can't provide
 * mentions (no token, capability unsupported) so the sync skips that account.
 */
export async function fetchMentionsForAccount(
  account: ConnectorAccount,
): Promise<NormalizedMention[]> {
  if (account.platform === 'facebook' || account.platform === 'instagram') {
    const { isRealListeningEnabled } = await import('./listening/config');
    if (await isRealListeningEnabled()) {
      if (!account.externalAccountId) return [];
      const tokens = await dbAsOrg(account.organizationId, (tx) =>
        readAccountTokens(tx, account.id),
      );
      if (!tokens?.accessToken) return [];
      const { fetchMetaMentions } = await import('./meta/mentions');
      return fetchMetaMentions(account.platform, account.externalAccountId, tokens.accessToken);
    }
  }
  const connector = getConnector(account.platform);
  if (typeof connector.fetchMentions !== 'function') return [];
  try {
    const page = await connector.fetchMentions(account, { limit: 25 });
    return [...page.items];
  } catch {
    // Platform doesn't declare read_mentions → skip rather than fail the sweep.
    return [];
  }
}
