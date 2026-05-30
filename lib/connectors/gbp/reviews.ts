import 'server-only';

import type { ConnectorAccount } from '../base/types';
import type { NormalizedReview } from '../base/normalized';
import { httpRequest, type HttpFn } from '../http';

import { GBP_API } from './config';

/**
 * Real Google Business Profile reviews API (C49). Pure (HTTP injected, token
 * passed in) — the caller (reviews-sync / reply dispatcher) loads the decrypted
 * token under the connection's org RLS. Only invoked on the real path
 * (isRealGbpEnabled); the mock connector serves fetch/reply otherwise.
 *
 * Reviews live on the v4 endpoint under the location resource name
 * (account.externalAccountId = `accounts/{a}/locations/{l}`).
 */

const STAR_TO_NUMBER: Readonly<Record<string, number>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

export interface GbpReviewsDeps {
  http: HttpFn;
}

function defaultDeps(): GbpReviewsDeps {
  return { http: httpRequest };
}

export async function fetchGbpReviews(
  account: ConnectorAccount,
  accessToken: string,
  deps: GbpReviewsDeps = defaultDeps(),
): Promise<NormalizedReview[]> {
  const res = await deps.http<{
    reviews?: Array<{
      reviewId?: string;
      name?: string;
      reviewer?: { displayName?: string; profilePhotoUrl?: string };
      starRating?: string;
      comment?: string;
      createTime?: string;
    }>;
  }>({
    method: 'GET',
    url: `${GBP_API}/${account.externalAccountId}/reviews`,
    platform: 'gbp',
    headers: { authorization: `Bearer ${accessToken}` },
  });

  const out: NormalizedReview[] = [];
  for (const r of res.data.reviews ?? []) {
    const externalId = r.reviewId ?? r.name;
    const rating = STAR_TO_NUMBER[r.starRating ?? ''];
    // Skip rows without a usable id or a 1..5 rating (reviews.rating has CHECK 1..5).
    if (!externalId || !rating) continue;
    out.push({
      platform: 'gbp',
      externalId,
      author: {
        platform: 'gbp',
        externalId: r.reviewer?.displayName ?? 'google-user',
        displayName: r.reviewer?.displayName ?? 'Google user',
        ...(r.reviewer?.profilePhotoUrl ? { avatarUrl: r.reviewer.profilePhotoUrl } : {}),
      },
      rating,
      body: r.comment ?? '',
      postedAt: r.createTime ? new Date(r.createTime) : new Date(),
    });
  }
  return out;
}

export async function replyGbpReview(
  account: ConnectorAccount,
  externalReviewId: string,
  text: string,
  accessToken: string,
  deps: GbpReviewsDeps = defaultDeps(),
): Promise<{ externalId: string }> {
  await deps.http({
    method: 'PUT',
    url: `${GBP_API}/${account.externalAccountId}/reviews/${externalReviewId}/reply`,
    platform: 'gbp',
    headers: { authorization: `Bearer ${accessToken}` },
    json: { comment: text },
  });
  // GBP replies have no separate id — the reply is addressed by the review name.
  return { externalId: `${externalReviewId}/reply` };
}
