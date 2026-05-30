import 'server-only';

import { metaCredsPresent } from '@/lib/connectors/meta/config';
import { isFlagOn } from '@/lib/flags';

/**
 * Ads real-vs-mock gating (C50). The real Meta Marketing API path serves ONLY
 * when the Meta app creds are present AND `use_real_meta_ads='on'` (read fresh
 * per call → operator rollback with `pnpm db:flag use_real_meta_ads off` lands
 * within one request). Reuses the SAME Meta app creds as the content connector
 * (no separate ads creds) — the ads scopes ride on the same OAuth consent.
 * Fail-safe to mock on any flag-read error.
 */
export async function isRealMetaAdsEnabled(): Promise<boolean> {
  if (!metaCredsPresent()) return false;
  return isFlagOn('use_real_meta_ads');
}
