import 'server-only';

import { env } from '@/lib/env';

import { httpJson } from '../http';
import type { ManagedAccount, OAuthProvider, TokenExchangeResult } from '../oauth/types';

import { isRealXEnabled, X_API_BASE, X_AUTH_URL, X_SCOPES, X_TOKEN_URL } from './config';

/**
 * X (Twitter) OAuth 2.0 + PKCE provider (C47). Confidential client: the token
 * call uses HTTP Basic auth (client_id:client_secret) plus the PKCE
 * code_verifier carried in the signed state. One account per authenticated user.
 */

function basicAuth(): string {
  return Buffer.from(`${env.X_CLIENT_ID ?? ''}:${env.X_CLIENT_SECRET ?? ''}`).toString('base64');
}

export const xOAuth: OAuthProvider = {
  platform: 'x',
  usesPkce: true,
  isRealEnabled: isRealXEnabled,

  buildAuthUrl(state, redirectUri, pkceChallenge) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.X_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: X_SCOPES.join(' '),
      state,
      code_challenge: pkceChallenge ?? 'challenge',
      code_challenge_method: 'S256',
    });
    return `${X_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri, pkceVerifier): Promise<TokenExchangeResult> {
    if (!(await isRealXEnabled())) {
      return { accessToken: `mock-x-token-${code.slice(0, 6) || 'dev'}`, expiresAt: null };
    }
    const r = await httpJson<{ access_token: string; refresh_token?: string; expires_in?: number }>({
      method: 'POST',
      url: X_TOKEN_URL,
      platform: 'x',
      headers: { authorization: `Basic ${basicAuth()}` },
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: env.X_CLIENT_ID,
        code_verifier: pkceVerifier ?? '',
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? null,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
    };
  },

  async listAccounts(tokens): Promise<ManagedAccount[]> {
    if (!(await isRealXEnabled())) {
      const seed = tokens.accessToken.slice(-6) || 'dev';
      return [
        {
          platform: 'x',
          externalId: `mock-x-${seed}`,
          name: 'Mock X Account',
          handle: '@mock_x',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
        },
      ];
    }
    const me = await httpJson<{ data?: { id: string; name?: string; username?: string } }>({
      method: 'GET',
      url: `${X_API_BASE}/users/me`,
      platform: 'x',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    const u = me.data;
    return [
      {
        platform: 'x',
        externalId: u?.id ?? 'unknown',
        name: u?.name ?? 'X Account',
        handle: u?.username ? `@${u.username}` : null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        tokenExpiresAt: tokens.expiresAt,
      },
    ];
  },
};
