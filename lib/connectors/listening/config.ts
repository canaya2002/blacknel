import 'server-only';

import { metaCredsPresent } from '@/lib/connectors/meta/config';
import { isFlagOn } from '@/lib/flags';

/**
 * Listening real-vs-mock gating (C53). The only achievable real platform mention
 * API today is Meta (FB page /tagged, IG /tags), so the gate reuses the Meta app
 * creds + `use_real_listening` (read fresh per call → operator rollback within
 * one request). Fail-safe to mock on flag-read error. Broad web listening (all
 * brand mentions on the internet) needs an external provider we don't have —
 * that stays out of scope; this covers mentions reachable via platform APIs.
 */
export async function isRealListeningEnabled(): Promise<boolean> {
  if (!metaCredsPresent()) return false;
  return isFlagOn('use_real_listening');
}
