import 'server-only';

import type { PlatformCode } from '../base/types';
import { linkedinOAuth } from '../linkedin/oauth';
import { tiktokOAuth } from '../tiktok/oauth';
import { xOAuth } from '../x/oauth';
import { youtubeOAuth } from '../youtube/oauth';

import type { OAuthProvider } from './types';

/**
 * OAuth provider registry (C47) for the generic `[provider]` connect flow. Meta
 * keeps its bespoke routes (Page→IG fan-out); these four are 1:1 platform↔OAuth.
 *
 * GAP (C47): these platforms ship connect + publish only. Inbox ingest
 * (comments/mentions/DMs) is poll-based for them (no webhooks like Meta) and is
 * NOT implemented — the MockConnector still serves mock fetch* in dev. Real
 * poll-ingest into inbox_threads/messages is follow-up work.
 */
const PROVIDERS: Partial<Record<PlatformCode, OAuthProvider>> = {
  linkedin: linkedinOAuth,
  tiktok: tiktokOAuth,
  x: xOAuth,
  youtube: youtubeOAuth,
};

export function getOAuthProvider(platform: string): OAuthProvider | null {
  return PROVIDERS[platform as PlatformCode] ?? null;
}

export const OAUTH_PROVIDER_PLATFORMS: ReadonlyArray<string> = Object.keys(PROVIDERS);
