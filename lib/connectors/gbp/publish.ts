import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import { PlatformError, TokenExpiredError } from '../base/errors';
import type { ConnectorAccount } from '../base/types';
import { httpRequest, type HttpFn } from '../http';
import { readAccountTokens, type ConnectionTokens } from '../tokens';

import { GBP_API } from './config';

/**
 * Real GBP local-post publisher (C49). Posts a STANDARD local post to the
 * location (distinct from the reviews API). Loads the decrypted token under the
 * connection's org RLS. Only the real path (publish-dispatch gates on
 * isRealGbpEnabled); mock stays in MockConnector.
 *
 * GAP: only STANDARD posts (EVENT/OFFER/ALERT topic types not exposed).
 */

export interface GbpPublishDeps {
  loadTokens: (account: ConnectorAccount) => Promise<ConnectionTokens | null>;
  http: HttpFn;
}

function defaultDeps(): GbpPublishDeps {
  return {
    loadTokens: (account) =>
      dbAsOrg(account.organizationId, (tx) => readAccountTokens(tx, account.id)),
    http: httpRequest,
  };
}

export async function publishToGbp(
  account: ConnectorAccount,
  draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  _options: { idempotencyKey?: string } = {},
  deps: GbpPublishDeps = defaultDeps(),
): Promise<{ externalId: string }> {
  const tokens = await deps.loadTokens(account);
  if (!tokens?.accessToken) throw new TokenExpiredError('gbp');

  const body: Record<string, unknown> = {
    languageCode: 'en-US',
    summary: draft.text,
    topicType: 'STANDARD',
  };
  const media = draft.mediaUrls ?? [];
  if (media.length > 0) {
    body.media = media.map((url) => ({ mediaFormat: 'PHOTO', sourceUrl: url }));
  }
  if (draft.link) {
    body.callToAction = { actionType: 'LEARN_MORE', url: draft.link };
  }

  const res = await deps.http<{ name?: string }>({
    method: 'POST',
    url: `${GBP_API}/${account.externalAccountId}/localPosts`,
    platform: 'gbp',
    headers: { authorization: `Bearer ${tokens.accessToken}` },
    json: body,
  });
  if (!res.data.name) throw new PlatformError('gbp', 'GBP local post created but no name returned.');
  return { externalId: res.data.name };
}
