import 'server-only';

import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';

/**
 * Meta connector gating + Graph API config (C46). Mirrors the C44 real-vs-mock
 * pattern: the real Graph path serves ONLY when the Meta creds are present AND
 * `use_real_meta='on'` in app_settings (read fresh per call → operator rollback
 * with `pnpm db:flag use_real_meta off` lands within one request). Fail-safe to
 * mock on any flag-read error.
 */

/** True when the env creds needed for the real OAuth + Graph flow are present. */
export function metaCredsPresent(): boolean {
  return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_REDIRECT_URI);
}

/** Gate: use the real Meta Graph path iff creds present AND the flag is on. */
export async function isRealMetaEnabled(): Promise<boolean> {
  if (!metaCredsPresent()) return false;
  return isFlagOn('use_real_meta');
}

/** Graph API base for the pinned version, e.g. https://graph.facebook.com/v21.0 */
export function graphBaseUrl(): string {
  return `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;
}

/** OAuth dialog base for the pinned version. */
export function oauthDialogUrl(): string {
  return `https://www.facebook.com/${env.META_GRAPH_VERSION}/dialog/oauth`;
}

/**
 * Scopes requested at connect time. Covers publishing (pages_manage_posts,
 * instagram_content_publish), reading engagement for inbox ingest, listing the
 * user's pages + IG business accounts, and (C50) reading + managing the user's
 * ad accounts via the Marketing API.
 *
 * `ads_read` + `ads_management` require Meta App Review (advanced access) before
 * they grant anything in production — until then the real ads path stays behind
 * `use_real_meta_ads` and the mock connector serves. Adding them here means the
 * SAME Meta consent that connects Pages/IG also authorizes the ads pillar; no
 * separate OAuth flow.
 */
export const META_SCOPES: ReadonlyArray<string> = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_messaging',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_comments',
  'ads_read',
  'ads_management',
];
