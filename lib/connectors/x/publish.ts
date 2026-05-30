import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import { PlatformError, TokenExpiredError } from '../base/errors';
import type { ConnectorAccount } from '../base/types';
import { fetchBytes, httpRequest, type FetchBytesFn, type HttpFn } from '../http';
import { isVideoUrl } from '../media-util';
import { readAccountTokens, type ConnectionTokens } from '../tokens';

import { X_API_BASE, X_UPLOAD_URL } from './config';

/**
 * Real X (Twitter) publisher (C47): API v2 POST /tweets, with images uploaded via
 * the simple media/upload (base64) endpoint and referenced by media_ids. Only the
 * real path (publish-dispatch gates on isRealXEnabled); mock stays in
 * MockConnector.
 *
 * GAP: video uses chunked INIT/APPEND/FINALIZE upload (not implemented) — images
 * + text only here; a video-only post throws. Validated at soak.
 */

export interface XPublishDeps {
  loadTokens: (account: ConnectorAccount) => Promise<ConnectionTokens | null>;
  http: HttpFn;
  fetchMedia: FetchBytesFn;
}

function defaultDeps(): XPublishDeps {
  return {
    loadTokens: (account) =>
      dbAsOrg(account.organizationId, (tx) => readAccountTokens(tx, account.id)),
    http: httpRequest,
    fetchMedia: fetchBytes,
  };
}

async function uploadImage(deps: XPublishDeps, token: string, url: string): Promise<string> {
  const bytes = await deps.fetchMedia(url);
  const b64 = Buffer.from(bytes).toString('base64');
  const res = await deps.http<{ media_id_string?: string; media_id?: number }>({
    method: 'POST',
    url: X_UPLOAD_URL,
    platform: 'x',
    headers: { authorization: `Bearer ${token}` },
    form: { media_data: b64 },
  });
  const id = res.data.media_id_string ?? (res.data.media_id ? String(res.data.media_id) : null);
  if (!id) throw new PlatformError('x', 'X media upload returned no media id.');
  return id;
}

export async function publishToX(
  account: ConnectorAccount,
  draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  _options: { idempotencyKey?: string } = {},
  deps: XPublishDeps = defaultDeps(),
): Promise<{ externalId: string }> {
  const tokens = await deps.loadTokens(account);
  if (!tokens?.accessToken) throw new TokenExpiredError('x');
  const token = tokens.accessToken;
  const media = draft.mediaUrls ?? [];

  if (media.some(isVideoUrl)) {
    throw new PlatformError('x', 'X video posting (chunked upload) is not implemented yet.');
  }

  const mediaIds: string[] = [];
  for (const url of media) mediaIds.push(await uploadImage(deps, token, url));

  // X has no link field — append the link to the text (≤280 enforced by composer).
  const text = draft.link ? `${draft.text} ${draft.link}`.trim() : draft.text;

  const res = await deps.http<{ data?: { id?: string } }>({
    method: 'POST',
    url: `${X_API_BASE}/tweets`,
    platform: 'x',
    headers: { authorization: `Bearer ${token}` },
    json: {
      text,
      ...(mediaIds.length > 0 ? { media: { media_ids: mediaIds } } : {}),
    },
  });
  const id = res.data.data?.id;
  if (!id) throw new PlatformError('x', 'X tweet created but no id was returned.');
  return { externalId: id };
}
