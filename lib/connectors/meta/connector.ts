import { env } from '@/lib/env';

import { MockConnector } from '../base/mock-connector';
import type { ConnectorAccount, ConnectorCapabilities, PlatformCode } from '../base/types';

import { useRealMeta } from './config';
import { publishToMeta } from './publish';

/**
 * Meta connector (C46) for Facebook Pages + Instagram Business. Extends the
 * shared MockConnector so every non-publish surface (sync, fetchComments,
 * fetchThreads, …) keeps the deterministic mock behavior, and overrides
 * `publishPost` to route to the real Graph API when useRealMeta() — fresh per
 * call, so flipping `pnpm db:flag use_real_meta off` reverts to mock within one
 * request. Real-vs-mock is decided here, not in the registry (which builds once).
 */
export class MetaConnector extends MockConnector {
  override async publishPost(
    account: ConnectorAccount,
    draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
    options: { idempotencyKey?: string } = {},
  ): Promise<{ externalId: string }> {
    if (await useRealMeta()) {
      this.ensureCapability('publish_post');
      return publishToMeta(account, draft, options);
    }
    return super.publishPost(account, draft, options);
  }
}

export function buildMetaConnector(
  platform: PlatformCode,
  capabilities: ConnectorCapabilities,
): MetaConnector {
  return new MetaConnector(platform, capabilities, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
