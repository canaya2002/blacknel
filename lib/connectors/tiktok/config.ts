import 'server-only';

import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';

/**
 * TikTok connector gating + config (C47). TikTok uses `client_key` (not
 * client_id). Direct publishing (video.publish) requires TikTok App Review /
 * audit approval — until then the app is limited to sandbox / draft mode.
 */

export function tiktokCredsPresent(): boolean {
  return Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
}

export async function isRealTiktokEnabled(): Promise<boolean> {
  if (!tiktokCredsPresent()) return false;
  return isFlagOn('use_real_tiktok');
}

export const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

// video.publish (direct post) gated behind App Review; video.upload posts to drafts.
export const TIKTOK_SCOPES: ReadonlyArray<string> = ['user.info.basic', 'video.publish', 'video.upload'];
