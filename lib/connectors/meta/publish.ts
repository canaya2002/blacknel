import 'server-only';

import { dbAsOrg } from '@/lib/db/client';

import { PlatformError, TokenExpiredError } from '../base/errors';
import type { ConnectorAccount } from '../base/types';
import { readAccountTokens, type ConnectionTokens } from '../tokens';

import { graphRequest as defaultGraph } from './graph';

/**
 * Real Meta publisher (C46). Reads the account's decrypted Page token (under its
 * own org RLS via dbAsOrg — tokens are never passed through ConnectorAccount),
 * then publishes via Graph:
 *
 *   - Facebook Page: no media → /{page}/feed; one image → /{page}/photos;
 *     many images → upload unpublished /{page}/photos then /{page}/feed with
 *     attached_media; video → /{page}/videos.
 *   - Instagram: container flow — /{ig}/media (single) or per-child + a CAROUSEL
 *     container, then /{ig}/media_publish. IG requires media.
 *
 * Media kind is inferred from the URL extension (R2 keys carry it) — see the C46
 * report for the limitation. Only invoked on the real path (isRealMetaEnabled()); the
 * mock path stays in MockConnector.
 */

export interface MetaPublishDraft {
  text: string;
  mediaUrls?: ReadonlyArray<string>;
  link?: string;
}

export interface MetaPublishDeps {
  loadTokens: (account: ConnectorAccount) => Promise<ConnectionTokens | null>;
  graph: typeof defaultGraph;
}

function defaultDeps(): MetaPublishDeps {
  return {
    loadTokens: (account) =>
      dbAsOrg(account.organizationId, (tx) => readAccountTokens(tx, account.id)),
    graph: defaultGraph,
  };
}

const VIDEO_EXT = /\.(mp4|mov|webm|m4v)(\?|$)/i;

function isVideoUrl(url: string): boolean {
  return VIDEO_EXT.test(url);
}

export async function publishToMeta(
  account: ConnectorAccount,
  draft: MetaPublishDraft,
  _options: { idempotencyKey?: string } = {},
  deps: MetaPublishDeps = defaultDeps(),
): Promise<{ externalId: string }> {
  const tokens = await deps.loadTokens(account);
  if (!tokens?.accessToken) {
    throw new TokenExpiredError(account.platform);
  }
  const targetId = account.externalAccountId;
  if (!targetId) {
    throw new PlatformError(account.platform, 'Connected account is missing its external id.');
  }

  const media = draft.mediaUrls ?? [];
  if (account.platform === 'instagram') {
    return publishInstagram(deps.graph, targetId, tokens.accessToken, draft.text, media);
  }
  return publishFacebook(deps.graph, targetId, tokens.accessToken, draft, media);
}

// --- Facebook Page ----------------------------------------------------------

async function publishFacebook(
  graph: typeof defaultGraph,
  pageId: string,
  accessToken: string,
  draft: MetaPublishDraft,
  media: ReadonlyArray<string>,
): Promise<{ externalId: string }> {
  // No media → simple feed post.
  if (media.length === 0) {
    const res = await graph<{ id: string }>({
      method: 'POST',
      path: `/${pageId}/feed`,
      platform: 'facebook',
      params: {
        message: draft.text,
        ...(draft.link ? { link: draft.link } : {}),
        access_token: accessToken,
      },
    });
    return { externalId: res.id };
  }

  // Single video → /videos.
  if (media.length === 1 && isVideoUrl(media[0]!)) {
    const res = await graph<{ id: string }>({
      method: 'POST',
      path: `/${pageId}/videos`,
      platform: 'facebook',
      params: { file_url: media[0], description: draft.text, access_token: accessToken },
    });
    return { externalId: res.id };
  }

  // Single image → /photos (published, with caption).
  if (media.length === 1) {
    const res = await graph<{ id: string; post_id?: string }>({
      method: 'POST',
      path: `/${pageId}/photos`,
      platform: 'facebook',
      params: { url: media[0], caption: draft.text, access_token: accessToken },
    });
    return { externalId: res.post_id ?? res.id };
  }

  // Many images → upload unpublished, then attach to a feed post.
  const mediaFbids: string[] = [];
  for (const url of media) {
    const photo = await graph<{ id: string }>({
      method: 'POST',
      path: `/${pageId}/photos`,
      platform: 'facebook',
      params: { url, published: false, access_token: accessToken },
    });
    mediaFbids.push(photo.id);
  }
  const attached: Record<string, string> = {};
  mediaFbids.forEach((fbid, i) => {
    attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: fbid });
  });
  const res = await graph<{ id: string }>({
    method: 'POST',
    path: `/${pageId}/feed`,
    platform: 'facebook',
    params: { message: draft.text, ...attached, access_token: accessToken },
  });
  return { externalId: res.id };
}

// --- Instagram Business -----------------------------------------------------

async function publishInstagram(
  graph: typeof defaultGraph,
  igId: string,
  accessToken: string,
  caption: string,
  media: ReadonlyArray<string>,
): Promise<{ externalId: string }> {
  if (media.length === 0) {
    throw new PlatformError('instagram', 'Instagram requiere al menos una imagen o video.');
  }

  let creationId: string;
  if (media.length === 1) {
    // Single image or REELS container.
    const url = media[0]!;
    const params: Record<string, string> = { caption, access_token: accessToken };
    if (isVideoUrl(url)) {
      params.media_type = 'REELS';
      params.video_url = url;
    } else {
      params.image_url = url;
    }
    const container = await graph<{ id: string }>({
      method: 'POST',
      path: `/${igId}/media`,
      platform: 'instagram',
      params,
    });
    creationId = container.id;
  } else {
    // Carousel: per-child containers → parent CAROUSEL container.
    const childIds: string[] = [];
    for (const url of media) {
      const childParams: Record<string, string> = {
        is_carousel_item: 'true',
        access_token: accessToken,
      };
      if (isVideoUrl(url)) {
        childParams.media_type = 'VIDEO';
        childParams.video_url = url;
      } else {
        childParams.image_url = url;
      }
      const child = await graph<{ id: string }>({
        method: 'POST',
        path: `/${igId}/media`,
        platform: 'instagram',
        params: childParams,
      });
      childIds.push(child.id);
    }
    const parent = await graph<{ id: string }>({
      method: 'POST',
      path: `/${igId}/media`,
      platform: 'instagram',
      params: {
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
        access_token: accessToken,
      },
    });
    creationId = parent.id;
  }

  const published = await graph<{ id: string }>({
    method: 'POST',
    path: `/${igId}/media_publish`,
    platform: 'instagram',
    params: { creation_id: creationId, access_token: accessToken },
  });
  return { externalId: published.id };
}
