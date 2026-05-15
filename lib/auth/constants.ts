/**
 * UUID sentinel for "this session has no organization yet". Set on a
 * brand-new user's session cookie until they finish onboarding. The
 * (app) layout redirects to /onboarding/start whenever it sees this
 * value, so no (app) page ever renders without a real org.
 *
 * Plain UUID format so it slots into existing `orgId: string` typing
 * without making Session.orgId nullable — keeps the type surface
 * unchanged across the rest of the codebase.
 */
export const NO_ORG_SENTINEL = '00000000-0000-0000-0000-000000000000';

export function hasOrg(orgId: string): boolean {
  return orgId !== NO_ORG_SENTINEL && orgId.length > 0;
}
