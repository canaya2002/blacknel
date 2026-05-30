import 'server-only';

import type { NormalizedPostInsights } from '../base/normalized';
import type { PlatformCode } from '../base/types';

import { graphRequest } from './graph';

/**
 * Real Meta per-post insights (C52) — cabled but INACTIVE until
 * `use_real_meta`/creds (gated by the dispatcher). FB and IG expose different
 * fields; both go through the shared graphRequest client (error taxonomy + test
 * fetch seam → zero network in CI). Honest simplification: IG has no public
 * `shares` count, and engagement falls back to likes+comments when the platform
 * doesn't return an engagement metric.
 */

function metricMap(
  data: Array<{ name?: string; values?: Array<{ value?: number }> }> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of data ?? []) {
    const v = m.values?.[0]?.value;
    if (m.name && typeof v === 'number') out[m.name] = v;
  }
  return out;
}

export async function fetchMetaPostInsights(
  platform: PlatformCode,
  externalPostId: string,
  accessToken: string,
): Promise<NormalizedPostInsights> {
  if (platform === 'instagram') {
    const r = await graphRequest<{
      like_count?: number;
      comments_count?: number;
      insights?: { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> };
    }>({
      method: 'GET',
      path: `/${externalPostId}`,
      platform: 'instagram',
      params: {
        access_token: accessToken,
        fields: 'like_count,comments_count,insights.metric(reach,impressions,engagement)',
      },
    });
    const ins = metricMap(r.insights?.data);
    const likes = r.like_count ?? 0;
    const comments = r.comments_count ?? 0;
    return {
      platform,
      externalPostId,
      reach: ins.reach ?? 0,
      impressions: ins.impressions ?? 0,
      likes,
      comments,
      shares: 0,
      engagement: ins.engagement ?? likes + comments,
    };
  }

  // facebook
  const r = await graphRequest<{
    likes?: { summary?: { total_count?: number } };
    comments?: { summary?: { total_count?: number } };
    shares?: { count?: number };
    insights?: { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> };
  }>({
    method: 'GET',
    path: `/${externalPostId}`,
    platform: 'facebook',
    params: {
      access_token: accessToken,
      fields:
        'likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_impressions_unique,post_engaged_users)',
    },
  });
  const ins = metricMap(r.insights?.data);
  const likes = r.likes?.summary?.total_count ?? 0;
  const comments = r.comments?.summary?.total_count ?? 0;
  const shares = r.shares?.count ?? 0;
  return {
    platform,
    externalPostId,
    reach: ins.post_impressions_unique ?? 0,
    impressions: ins.post_impressions ?? 0,
    likes,
    comments,
    shares,
    engagement: ins.post_engaged_users ?? likes + comments + shares,
  };
}
