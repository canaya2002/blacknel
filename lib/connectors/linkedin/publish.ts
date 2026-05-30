import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import { PlatformError, TokenExpiredError } from '../base/errors';
import type { ConnectorAccount } from '../base/types';
import { fetchBytes, httpRequest, type FetchBytesFn, type HttpFn } from '../http';
import { isVideoUrl } from '../media-util';
import { readAccountTokens, type ConnectionTokens } from '../tokens';

import { LINKEDIN_API_BASE, LINKEDIN_API_VERSION } from './config';

/**
 * Real LinkedIn publisher (C47) via the Posts API. Author URN (member or company
 * page) is the account's external id. Text, article link, and image/video posts
 * (single + multi-image). Media uploads via the images/videos initializeUpload →
 * PUT-bytes flow (bytes pulled from R2 via deps.fetchMedia). The created post id
 * comes back in the `x-restli-id` response header. Only the real path (gated by
 * isRealLinkedinEnabled); mock stays in MockConnector.
 *
 * Images upload single-shot; videos use the multi-part uploadInstructions flow
 * (PUT each byte range, collect ETags, finalizeUpload). Validated at soak.
 */

export interface LinkedinPublishDeps {
  loadTokens: (account: ConnectorAccount) => Promise<ConnectionTokens | null>;
  http: HttpFn;
  fetchMedia: FetchBytesFn;
}

function defaultDeps(): LinkedinPublishDeps {
  return {
    loadTokens: (account) =>
      dbAsOrg(account.organizationId, (tx) => readAccountTokens(tx, account.id)),
    http: httpRequest,
    fetchMedia: fetchBytes,
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'linkedin-version': LINKEDIN_API_VERSION,
    'x-restli-protocol-version': '2.0.0',
  };
}

function uploadAsset(
  deps: LinkedinPublishDeps,
  owner: string,
  token: string,
  url: string,
): Promise<string> {
  return isVideoUrl(url)
    ? uploadVideo(deps, owner, token, url)
    : uploadImage(deps, owner, token, url);
}

async function uploadImage(
  deps: LinkedinPublishDeps,
  owner: string,
  token: string,
  url: string,
): Promise<string> {
  const init = await deps.http<{ value?: { uploadUrl?: string; image?: string } }>({
    method: 'POST',
    url: `${LINKEDIN_API_BASE}/images?action=initializeUpload`,
    platform: 'linkedin',
    headers: authHeaders(token),
    json: { initializeUploadRequest: { owner } },
  });
  const v = init.data.value ?? {};
  if (!v.uploadUrl || !v.image) {
    throw new PlatformError('linkedin', 'LinkedIn image upload initialization failed.');
  }
  const bytes = await deps.fetchMedia(url);
  await deps.http({
    method: 'PUT',
    url: v.uploadUrl,
    platform: 'linkedin',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  return v.image;
}

async function uploadVideo(
  deps: LinkedinPublishDeps,
  owner: string,
  token: string,
  url: string,
): Promise<string> {
  // LinkedIn needs the file size up front, then returns per-part upload URLs.
  const bytes = await deps.fetchMedia(url);
  const init = await deps.http<{
    value?: {
      video?: string;
      uploadToken?: string;
      uploadInstructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
    };
  }>({
    method: 'POST',
    url: `${LINKEDIN_API_BASE}/videos?action=initializeUpload`,
    platform: 'linkedin',
    headers: authHeaders(token),
    json: {
      initializeUploadRequest: {
        owner,
        fileSizeBytes: bytes.length,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    },
  });
  const v = init.data.value ?? {};
  const instructions = v.uploadInstructions ?? [];
  if (!v.video || !v.uploadToken || instructions.length === 0) {
    throw new PlatformError(
      'linkedin',
      'LinkedIn video upload init incomplete (missing video / uploadToken / instructions).',
    );
  }
  // PUT each byte range; LinkedIn returns the part id in the ETag header. A
  // missing ETag means the part wasn't accepted — fail rather than finalize an
  // incomplete part list.
  const uploadedPartIds: string[] = [];
  for (const ins of instructions) {
    const chunk = bytes.slice(ins.firstByte, ins.lastByte + 1);
    const put = await deps.http({
      method: 'PUT',
      url: ins.uploadUrl,
      platform: 'linkedin',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: chunk,
    });
    const etag = put.headers.get('etag');
    if (!etag) {
      throw new PlatformError('linkedin', 'LinkedIn video chunk upload returned no ETag.');
    }
    uploadedPartIds.push(etag);
  }
  await deps.http({
    method: 'POST',
    url: `${LINKEDIN_API_BASE}/videos?action=finalizeUpload`,
    platform: 'linkedin',
    headers: authHeaders(token),
    json: {
      finalizeUploadRequest: {
        video: v.video,
        uploadToken: v.uploadToken,
        uploadedPartIds,
      },
    },
  });
  return v.video;
}

export async function publishToLinkedin(
  account: ConnectorAccount,
  draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  _options: { idempotencyKey?: string } = {},
  deps: LinkedinPublishDeps = defaultDeps(),
): Promise<{ externalId: string }> {
  const tokens = await deps.loadTokens(account);
  if (!tokens?.accessToken) throw new TokenExpiredError('linkedin');
  const author = account.externalAccountId;
  if (!author) throw new PlatformError('linkedin', 'Connected account is missing its author URN.');
  const token = tokens.accessToken;
  const media = draft.mediaUrls ?? [];

  let content: Record<string, unknown> | undefined;
  if (media.length > 0) {
    const urns: string[] = [];
    for (const url of media) urns.push(await uploadAsset(deps, author, token, url));
    content =
      urns.length === 1
        ? { media: { id: urns[0] } }
        : { multiImage: { images: urns.map((id) => ({ id })) } };
  } else if (draft.link) {
    content = { article: { source: draft.link, title: draft.text.slice(0, 100) || draft.link } };
  }

  const res = await deps.http<{ id?: string }>({
    method: 'POST',
    url: `${LINKEDIN_API_BASE}/posts`,
    platform: 'linkedin',
    headers: authHeaders(token),
    json: {
      author,
      commentary: draft.text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
      ...(content ? { content } : {}),
    },
  });

  const id =
    res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id') ?? res.data?.id ?? null;
  if (!id) throw new PlatformError('linkedin', 'LinkedIn post created but no id was returned.');
  return { externalId: id };
}
