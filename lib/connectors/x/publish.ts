import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import { PlatformError, TokenExpiredError } from '../base/errors';
import type { ConnectorAccount } from '../base/types';
import { fetchBytes, httpRequest, type FetchBytesFn, type HttpFn } from '../http';
import { isVideoUrl } from '../media-util';
import { readAccountTokens, type ConnectionTokens } from '../tokens';

import { X_API_BASE, X_UPLOAD_URL } from './config';

/**
 * Real X (Twitter) publisher (C47→C48): API v2 POST /tweets. Images upload via
 * the simple media/upload (base64); video uses the chunked INIT/APPEND/FINALIZE
 * flow + STATUS polling until the async transcode succeeds. X allows a single
 * video OR up to 4 images (not mixed). Only the real path (publish-dispatch gates
 * on isRealXEnabled); mock stays in MockConnector.
 */

const VIDEO_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MB APPEND segments
const STATUS_POLL_MAX_ATTEMPTS = 15;

export interface XPublishDeps {
  loadTokens: (account: ConnectorAccount) => Promise<ConnectionTokens | null>;
  http: HttpFn;
  fetchMedia: FetchBytesFn;
  sleep: (ms: number) => Promise<void>;
}

function defaultDeps(): XPublishDeps {
  return {
    loadTokens: (account) =>
      dbAsOrg(account.organizationId, (tx) => readAccountTokens(tx, account.id)),
    http: httpRequest,
    fetchMedia: fetchBytes,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function videoMime(url: string): string {
  if (/\.mov(\?|$)/i.test(url)) return 'video/quicktime';
  if (/\.webm(\?|$)/i.test(url)) return 'video/webm';
  return 'video/mp4';
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

interface ProcessingInfo {
  state?: string;
  check_after_secs?: number;
}

async function uploadVideoChunked(deps: XPublishDeps, token: string, url: string): Promise<string> {
  const headers = { authorization: `Bearer ${token}` };
  const bytes = await deps.fetchMedia(url);

  // INIT
  const init = await deps.http<{ media_id_string?: string }>({
    method: 'POST',
    url: X_UPLOAD_URL,
    platform: 'x',
    headers,
    form: {
      command: 'INIT',
      total_bytes: bytes.length,
      media_type: videoMime(url),
      media_category: 'tweet_video',
    },
  });
  const mediaId = init.data.media_id_string;
  if (!mediaId) throw new PlatformError('x', 'X video INIT returned no media id.');

  // APPEND (chunked)
  let segment = 0;
  for (let offset = 0; offset < bytes.length; offset += VIDEO_CHUNK_BYTES) {
    const chunk = bytes.slice(offset, offset + VIDEO_CHUNK_BYTES);
    await deps.http({
      method: 'POST',
      url: X_UPLOAD_URL,
      platform: 'x',
      headers,
      form: {
        command: 'APPEND',
        media_id: mediaId,
        segment_index: segment,
        media_data: Buffer.from(chunk).toString('base64'),
      },
    });
    segment += 1;
  }

  // FINALIZE → may return async processing_info; poll STATUS until succeeded.
  const fin = await deps.http<{ processing_info?: ProcessingInfo }>({
    method: 'POST',
    url: X_UPLOAD_URL,
    platform: 'x',
    headers,
    form: { command: 'FINALIZE', media_id: mediaId },
  });
  let info = fin.data.processing_info;
  let attempts = 0;
  while (info && (info.state === 'pending' || info.state === 'in_progress') && attempts < STATUS_POLL_MAX_ATTEMPTS) {
    await deps.sleep((info.check_after_secs ?? 1) * 1000);
    const st = await deps.http<{ processing_info?: ProcessingInfo }>({
      method: 'GET',
      url: `${X_UPLOAD_URL}?command=STATUS&media_id=${mediaId}`,
      platform: 'x',
      headers,
    });
    info = st.data.processing_info;
    attempts += 1;
  }
  if (info && info.state === 'failed') {
    throw new PlatformError('x', `X video processing failed (media ${mediaId}).`);
  }
  return mediaId;
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
  const videos = media.filter(isVideoUrl);
  const images = media.filter((u) => !isVideoUrl(u));

  const mediaIds: string[] = [];
  if (videos.length > 0) {
    if (videos.length > 1 || images.length > 0) {
      throw new PlatformError('x', 'X supports a single video OR up to 4 images, not mixed.');
    }
    mediaIds.push(await uploadVideoChunked(deps, token, videos[0]!));
  } else {
    for (const url of images) mediaIds.push(await uploadImage(deps, token, url));
  }

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
