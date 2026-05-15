import 'server-only';

import { randomBytes } from 'node:crypto';

/**
 * Invitation tokens are URL-safe random strings (32 bytes encoded as
 * base64url). The token is the *only* secret that grants membership
 * to an org — keep it server-side until it lands in the invitee's
 * inbox (or, in Phase 1–10, in the /team "Pending invitations" panel).
 *
 * Tokens are stored verbatim in `invitations.token` and indexed unique.
 * No hashing today — the value is single-use, scoped, short-lived. If
 * we ever expose stricter security requirements (e.g. SOC 2), swap
 * `invitations.token` for a `token_hash` column and hash on the way in
 * here.
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 7-day expiration matches the rest of our timed flows (sessions, OAuth). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function invitationAcceptPath(token: string): string {
  return `/auth/accept/${encodeURIComponent(token)}`;
}

export function invitationAcceptUrl(appUrl: string, token: string): string {
  // `URL` would re-encode, which we don't want for a path that already
  // contains an encoded token.
  const base = appUrl.replace(/\/$/, '');
  return `${base}${invitationAcceptPath(token)}`;
}
