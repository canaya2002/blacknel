import 'server-only';

import { env } from '@/lib/env';

import { httpJson } from '../http';
import type { ManagedAccount, OAuthProvider, TokenExchangeResult } from '../oauth/types';

import {
  isRealTiktokEnabled,
  TIKTOK_API_BASE,
  TIKTOK_AUTH_URL,
  TIKTOK_SCOPES,
  TIKTOK_TOKEN_URL,
} from './config';

/** TikTok OAuth provider (C47). One account per user (open_id). */
export const tiktokOAuth: OAuthProvider = {
  platform: 'tiktok',

  isRealEnabled: isRealTiktokEnabled,

  buildAuthUrl(state, redirectUri) {
    const params = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY ?? '',
      response_type: 'code',
      scope: TIKTOK_SCOPES.join(','),
      redirect_uri: redirectUri,
      state,
    });
    return `${TIKTOK_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri): Promise<TokenExchangeResult> {
    if (!(await isRealTiktokEnabled())) {
      return { accessToken: `mock-tiktok-token-${code.slice(0, 6) || 'dev'}`, expiresAt: null };
    }
    const r = await httpJson<{
      access_token: string;
      expires_in?: number;
      refresh_token?: string;
      open_id?: string;
    }>({
      method: 'POST',
      url: TIKTOK_TOKEN_URL,
      platform: 'tiktok',
      form: {
        client_key: env.TIKTOK_CLIENT_KEY,
        client_secret: env.TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? null,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
      ...(r.open_id ? { raw: { open_id: r.open_id } } : {}),
    };
  },

  async listAccounts(tokens): Promise<ManagedAccount[]> {
    if (!(await isRealTiktokEnabled())) {
      const seed = tokens.accessToken.slice(-6) || 'dev';
      return [
        {
          platform: 'tiktok',
          externalId: `mock-tiktok-${seed}`,
          name: 'Mock TikTok',
          handle: '@mock_tiktok',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
        },
      ];
    }
    const info = await httpJson<{ data?: { user?: { open_id?: string; display_name?: string } } }>({
      method: 'GET',
      url: `${TIKTOK_API_BASE}/user/info/?fields=open_id,display_name`,
      platform: 'tiktok',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    const u = info.data?.user ?? {};
    const openId = u.open_id ?? (tokens.raw?.open_id as string | undefined) ?? 'unknown';
    return [
      {
        platform: 'tiktok',
        externalId: openId,
        name: u.display_name ?? 'TikTok',
        handle: u.display_name ? `@${u.display_name}` : null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        tokenExpiresAt: tokens.expiresAt,
      },
    ];
  },
};
