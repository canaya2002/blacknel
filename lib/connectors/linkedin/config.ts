import 'server-only';

import { env } from '@/lib/env';
import { isFlagOn } from '@/lib/flags';

/**
 * LinkedIn connector gating + config (C47). Real path serves only when the
 * client creds are set AND use_real_linkedin='on' (read fresh per call,
 * fail-safe to mock). API version is the LinkedIn-Version header (YYYYMM),
 * pinned so a version bump is a config change.
 */

export function linkedinCredsPresent(): boolean {
  return Boolean(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET);
}

export async function isRealLinkedinEnabled(): Promise<boolean> {
  if (!linkedinCredsPresent()) return false;
  return isFlagOn('use_real_linkedin');
}

export const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
/** LinkedIn-Version header (YYYYMM). */
export const LINKEDIN_API_VERSION = '202405';

export const LINKEDIN_SCOPES: ReadonlyArray<string> = [
  'openid',
  'profile',
  'w_member_social',
  'r_organization_social',
  'w_organization_social',
  'rw_organization_admin',
];
