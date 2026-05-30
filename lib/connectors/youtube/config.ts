import 'server-only';

import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';

/** YouTube (Google) connector gating + config (C47). Data API v3 + Google OAuth. */

export function youtubeCredsPresent(): boolean {
  return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET);
}

export async function isRealYoutubeEnabled(): Promise<boolean> {
  if (!youtubeCredsPresent()) return false;
  return isFlagOn('use_real_youtube');
}

export const YT_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const YT_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const YT_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

export const YT_SCOPES: ReadonlyArray<string> = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'openid',
  'email',
];
