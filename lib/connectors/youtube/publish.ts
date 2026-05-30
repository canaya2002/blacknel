import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import { PlatformError, TokenExpiredError } from '../base/errors';
import type { ConnectorAccount } from '../base/types';
import { fetchBytes, httpRequest, type FetchBytesFn, type HttpFn } from '../http';
import { isVideoUrl } from '../media-util';
import { readAccountTokens, type ConnectionTokens } from '../tokens';

import { YT_UPLOAD_BASE } from './config';

/**
 * Real YouTube publisher (C47): resumable video upload via the Data API v3
 * Videos.insert. Two steps — init (POST ...?uploadType=resumable returns the
 * upload URL in the `location` header) then PUT the bytes (pulled from R2 via
 * deps.fetchMedia). Title/description/privacy from the draft. Only the real path
 * (publish-dispatch gates on isRealYoutubeEnabled); mock stays in MockConnector.
 *
 * GAP: single-shot PUT (no chunked/resumable retry of partial uploads) — fine
 * for typical sizes, revisit for very large files. Community posts (text/image)
 * have no stable public API → video-only here; non-video drafts throw.
 */

export interface YoutubePublishDeps {
  loadTokens: (account: ConnectorAccount) => Promise<ConnectionTokens | null>;
  http: HttpFn;
  fetchMedia: FetchBytesFn;
}

function defaultDeps(): YoutubePublishDeps {
  return {
    loadTokens: (account) =>
      dbAsOrg(account.organizationId, (tx) => readAccountTokens(tx, account.id)),
    http: httpRequest,
    fetchMedia: fetchBytes,
  };
}

export async function publishToYoutube(
  account: ConnectorAccount,
  draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  _options: { idempotencyKey?: string } = {},
  deps: YoutubePublishDeps = defaultDeps(),
): Promise<{ externalId: string }> {
  const tokens = await deps.loadTokens(account);
  if (!tokens?.accessToken) throw new TokenExpiredError('youtube');
  const video = (draft.mediaUrls ?? []).find(isVideoUrl);
  if (!video) throw new PlatformError('youtube', 'YouTube requiere un video para publicar.');
  const token = tokens.accessToken;

  // Title: first line of the text (≤100), description: full text.
  const title = (draft.text.split('\n')[0] || 'Untitled').slice(0, 100);

  // 1. Init resumable upload — the upload URL comes back in the `location` header.
  const init = await deps.http<unknown>({
    method: 'POST',
    url: `${YT_UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`,
    platform: 'youtube',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-upload-content-type': 'video/*',
    },
    json: {
      snippet: { title, description: draft.text },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    },
  });
  const uploadUrl = init.headers.get('location');
  if (!uploadUrl) throw new PlatformError('youtube', 'YouTube resumable init returned no upload URL.');

  // 2. PUT the bytes to the resumable session URL.
  const bytes = await deps.fetchMedia(video);
  const res = await deps.http<{ id?: string }>({
    method: 'PUT',
    url: uploadUrl,
    platform: 'youtube',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'video/*' },
    body: bytes,
  });
  const id = res.data?.id;
  if (!id) throw new PlatformError('youtube', 'YouTube upload completed but no video id was returned.');
  return { externalId: id };
}
