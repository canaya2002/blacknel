import 'server-only';

import { randomBytes } from 'node:crypto';

import { env } from '@/lib/env';

import {
  decryptJson,
  encryptJson,
  isEncryptedEnvelope,
  type EncryptedEnvelope,
} from '../crypto';

import { META_SCOPES, oauthDialogUrl, useRealMeta } from './config';
import { graphRequest } from './graph';

/**
 * Meta OAuth flow (C46): build the dialog URL, sign/verify the CSRF `state`,
 * exchange the code for a long-lived token, and list the user's Pages + linked
 * Instagram Business accounts. Real path hits Graph; mock path (useRealMeta off)
 * returns deterministic fake accounts so dev/CI exercise the whole flow.
 *
 * `state` is an AES-256-GCM envelope of {orgId, userId, nonce, exp} (reusing the
 * connector encryption key) → opaque + integrity-protected + confidential. The
 * callback decrypts it, checks expiry, and matches orgId/userId against the live
 * session (defence against CSRF + cross-tenant replay).
 */

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  orgId: string;
  userId: string;
  nonce: string;
  exp: number;
}

export function signState(p: { orgId: string; userId: string }): string {
  const payload: StatePayload = {
    orgId: p.orgId,
    userId: p.userId,
    nonce: randomBytes(8).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  };
  const envelope = encryptJson(payload);
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

export function verifyState(token: string): { orgId: string; userId: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
    if (!isEncryptedEnvelope(parsed)) return null;
    const p = decryptJson<StatePayload>(parsed as EncryptedEnvelope);
    if (typeof p.exp !== 'number' || p.exp < Date.now()) return null;
    if (!p.orgId || !p.userId) return null;
    return { orgId: p.orgId, userId: p.userId };
  } catch {
    return null;
  }
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.META_APP_ID ?? '',
    redirect_uri: env.META_REDIRECT_URI ?? '',
    state,
    response_type: 'code',
    scope: META_SCOPES.join(','),
  });
  return `${oauthDialogUrl()}?${params.toString()}`;
}

export interface ManagedAccount {
  readonly platform: 'facebook' | 'instagram';
  /** Page id or IG business account id. */
  readonly externalId: string;
  readonly name: string;
  readonly handle: string | null;
  /** Long-lived Page access token (also used to publish the linked IG account). */
  readonly accessToken: string;
  readonly tokenExpiresAt: string | null;
  /** For IG accounts: the parent Page id (IG publishes through the Page token). */
  readonly parentPageId?: string;
}

/** Exchange the OAuth code for a long-lived user token. Mock when useRealMeta off. */
export async function exchangeCodeForTokens(
  code: string,
): Promise<{ userAccessToken: string; expiresAt: string | null }> {
  if (!(await useRealMeta())) {
    return { userAccessToken: `mock-user-token-${code.slice(0, 8) || 'dev'}`, expiresAt: null };
  }
  // 1. code → short-lived user token.
  const short = await graphRequest<{ access_token: string }>({
    method: 'GET',
    path: '/oauth/access_token',
    params: {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: env.META_REDIRECT_URI,
      code,
    },
  });
  // 2. short-lived → long-lived (~60 days).
  const long = await graphRequest<{ access_token: string; expires_in?: number }>({
    method: 'GET',
    path: '/oauth/access_token',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    },
  });
  const expiresAt = long.expires_in
    ? new Date(Date.now() + long.expires_in * 1000).toISOString()
    : null;
  return { userAccessToken: long.access_token, expiresAt };
}

/** List the user's Pages + linked IG Business accounts. Mock when useRealMeta off. */
export async function listManagedAccounts(userAccessToken: string): Promise<ManagedAccount[]> {
  if (!(await useRealMeta())) {
    const seed = userAccessToken.slice(-6) || 'dev';
    return [
      {
        platform: 'facebook',
        externalId: `mock-page-${seed}`,
        name: 'Mock Facebook Page',
        handle: '@mock-page',
        accessToken: `mock-page-token-${seed}`,
        tokenExpiresAt: null,
      },
      {
        platform: 'instagram',
        externalId: `mock-ig-${seed}`,
        name: 'Mock Instagram Business',
        handle: '@mock_ig',
        accessToken: `mock-page-token-${seed}`,
        tokenExpiresAt: null,
        parentPageId: `mock-page-${seed}`,
      },
    ];
  }

  const pages = await graphRequest<{
    data?: Array<{
      id: string;
      name: string;
      access_token: string;
      instagram_business_account?: { id: string; username?: string };
    }>;
  }>({
    method: 'GET',
    path: '/me/accounts',
    params: {
      access_token: userAccessToken,
      fields: 'id,name,access_token,instagram_business_account{id,username}',
    },
  });

  const out: ManagedAccount[] = [];
  for (const pg of pages.data ?? []) {
    out.push({
      platform: 'facebook',
      externalId: pg.id,
      name: pg.name,
      handle: null,
      accessToken: pg.access_token,
      tokenExpiresAt: null,
    });
    const ig = pg.instagram_business_account;
    if (ig) {
      out.push({
        platform: 'instagram',
        externalId: ig.id,
        name: ig.username ?? pg.name,
        handle: ig.username ? `@${ig.username}` : null,
        // IG content publishing uses the linked Page's access token.
        accessToken: pg.access_token,
        tokenExpiresAt: null,
        parentPageId: pg.id,
      });
    }
  }
  return out;
}
