import 'server-only';

import type { NormalizedMention } from '../base/normalized';
import type { PlatformCode } from '../base/types';

import { graphRequest } from './graph';

/**
 * Real Meta @mention/tag fetch (C53) — cabled but INACTIVE until
 * `use_real_listening` + creds (gated by the dispatcher). FB: posts where the
 * Page is tagged (`/{page-id}/tagged`). IG: media where the business is
 * @mentioned (`/{ig-user-id}/tags`). Both via the shared graphRequest client
 * (error taxonomy + test fetch seam → zero network in CI).
 *
 * Honest API limits: `/tagged` + `/tags` need advanced permissions (App Review)
 * and only surface mentions ON the owned account — NOT arbitrary web mentions.
 * Other platforms (X/TikTok/LinkedIn) have no comparable public mention search
 * without an external listening provider; they stay mock-only.
 */
export async function fetchMetaMentions(
  platform: PlatformCode,
  externalAccountId: string,
  accessToken: string,
): Promise<NormalizedMention[]> {
  if (platform === 'instagram') {
    const r = await graphRequest<{
      data?: Array<{ id: string; caption?: string; username?: string; permalink?: string; timestamp?: string }>;
    }>({
      method: 'GET',
      path: `/${externalAccountId}/tags`,
      platform: 'instagram',
      params: { access_token: accessToken, fields: 'id,caption,username,permalink,timestamp' },
    });
    return (r.data ?? []).map((m): NormalizedMention => ({
      platform,
      externalId: m.id,
      author: {
        platform,
        externalId: m.username ?? '',
        displayName: m.username ?? 'unknown',
        ...(m.username ? { handle: m.username } : {}),
      },
      body: m.caption ?? '',
      postedAt: m.timestamp ? new Date(m.timestamp) : new Date(),
      url: m.permalink ?? '',
    }));
  }

  // facebook
  const r = await graphRequest<{
    data?: Array<{
      id: string;
      message?: string;
      story?: string;
      from?: { id?: string; name?: string };
      permalink_url?: string;
      created_time?: string;
    }>;
  }>({
    method: 'GET',
    path: `/${externalAccountId}/tagged`,
    platform: 'facebook',
    params: { access_token: accessToken, fields: 'id,message,story,from,permalink_url,created_time' },
  });
  return (r.data ?? []).map((m): NormalizedMention => ({
    platform,
    externalId: m.id,
    author: {
      platform,
      externalId: m.from?.id ?? '',
      displayName: m.from?.name ?? 'unknown',
      ...(m.from?.name ? { handle: m.from.name } : {}),
    },
    body: m.message ?? m.story ?? '',
    postedAt: m.created_time ? new Date(m.created_time) : new Date(),
    url: m.permalink_url ?? '',
  }));
}
