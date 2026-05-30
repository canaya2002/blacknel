import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import { PlatformError, TokenExpiredError } from '../base/errors';
import type { ConnectorAccount } from '../base/types';
import { httpRequest, type HttpFn } from '../http';
import { isVideoUrl } from '../media-util';
import { readAccountTokens, type ConnectionTokens } from '../tokens';

import { TIKTOK_API_BASE } from './config';

/**
 * Real TikTok publisher (C47) via the Content Posting API, PULL_FROM_URL (TikTok
 * fetches the video from the R2 URL — no byte upload from us). Video only; then
 * polls the publish status until PUBLISH_COMPLETE (like IG REELS). Direct publish
 * needs the video.publish scope (App Review); otherwise the call posts to drafts.
 * Only reached on the real path (publish-dispatch gates on isRealTiktokEnabled);
 * mock stays in MockConnector.
 */

const POLL_MAX_ATTEMPTS = 15;
const POLL_DELAY_MS = 2000;

export interface TiktokPublishDeps {
  loadTokens: (account: ConnectorAccount) => Promise<ConnectionTokens | null>;
  http: HttpFn;
  sleep: (ms: number) => Promise<void>;
}

function defaultDeps(): TiktokPublishDeps {
  return {
    loadTokens: (account) =>
      dbAsOrg(account.organizationId, (tx) => readAccountTokens(tx, account.id)),
    http: httpRequest,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export async function publishToTiktok(
  account: ConnectorAccount,
  draft: { text: string; mediaUrls?: ReadonlyArray<string>; link?: string },
  _options: { idempotencyKey?: string } = {},
  deps: TiktokPublishDeps = defaultDeps(),
): Promise<{ externalId: string }> {
  const tokens = await deps.loadTokens(account);
  if (!tokens?.accessToken) throw new TokenExpiredError('tiktok');
  const video = (draft.mediaUrls ?? []).find(isVideoUrl);
  if (!video) throw new PlatformError('tiktok', 'TikTok requires a video to publish.');
  const token = tokens.accessToken;
  const headers = { authorization: `Bearer ${token}` };

  const init = await deps.http<{ data?: { publish_id?: string } }>({
    method: 'POST',
    url: `${TIKTOK_API_BASE}/post/publish/video/init/`,
    platform: 'tiktok',
    headers,
    json: {
      post_info: {
        title: draft.text.slice(0, 2200),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_comment: false,
        disable_duet: false,
        disable_stitch: false,
      },
      source_info: { source: 'PULL_FROM_URL', video_url: video },
    },
  });
  const publishId = init.data.data?.publish_id;
  if (!publishId) throw new PlatformError('tiktok', 'TikTok init did not return a publish_id.');

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    const st = await deps.http<{
      data?: { status?: string; publicaly_available_post_id?: string[] };
    }>({
      method: 'POST',
      url: `${TIKTOK_API_BASE}/post/publish/status/fetch/`,
      platform: 'tiktok',
      headers,
      json: { publish_id: publishId },
    });
    const status = st.data.data?.status;
    if (status === 'PUBLISH_COMPLETE') {
      // `publicaly_available_post_id` matches TikTok's (misspelled) API field;
      // re-verify against the live API at soak.
      return { externalId: st.data.data?.publicaly_available_post_id?.[0] ?? publishId };
    }
    if (status === 'FAILED') {
      throw new PlatformError('tiktok', `TikTok publish failed (publish_id ${publishId}).`);
    }
    await deps.sleep(POLL_DELAY_MS);
  }
  throw new PlatformError('tiktok', `TikTok publish not complete after ${POLL_MAX_ATTEMPTS} polls.`);
}
