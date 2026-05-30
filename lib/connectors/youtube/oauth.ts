import 'server-only';

import { env } from '@/lib/env';

import { httpJson } from '../http';
import type { ManagedAccount, OAuthProvider, TokenExchangeResult } from '../oauth/types';
import type { ConnectionTokens } from '../tokens';

import {
  isRealYoutubeEnabled,
  YT_API_BASE,
  YT_AUTH_URL,
  YT_SCOPES,
  YT_TOKEN_URL,
} from './config';

/**
 * YouTube (Google) OAuth provider (C47). access_type=offline + prompt=consent so
 * we get a refresh token. Connects the user's channel(s). Mock returns a fake
 * channel.
 */
export const youtubeOAuth: OAuthProvider = {
  platform: 'youtube',
  isRealEnabled: isRealYoutubeEnabled,

  buildAuthUrl(state, redirectUri) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.YOUTUBE_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: YT_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${YT_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri): Promise<TokenExchangeResult> {
    if (!(await isRealYoutubeEnabled())) {
      return { accessToken: `mock-youtube-token-${code.slice(0, 6) || 'dev'}`, expiresAt: null };
    }
    const r = await httpJson<{ access_token: string; refresh_token?: string; expires_in?: number }>({
      method: 'POST',
      url: YT_TOKEN_URL,
      platform: 'youtube',
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? null,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
    };
  },

  async listAccounts(tokens): Promise<ManagedAccount[]> {
    if (!(await isRealYoutubeEnabled())) {
      const seed = tokens.accessToken.slice(-6) || 'dev';
      return [
        {
          platform: 'youtube',
          externalId: `mock-yt-channel-${seed}`,
          name: 'Mock YouTube Channel',
          handle: '@mock_youtube',
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
        },
      ];
    }
    const res = await httpJson<{
      items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }>;
    }>({
      method: 'GET',
      url: `${YT_API_BASE}/channels?part=snippet&mine=true`,
      platform: 'youtube',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    return (res.items ?? []).map((ch) => ({
      platform: 'youtube' as const,
      externalId: ch.id,
      name: ch.snippet?.title ?? 'YouTube Channel',
      handle: ch.snippet?.customUrl ?? null,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      tokenExpiresAt: tokens.expiresAt,
    }));
  },

  async refreshAccessToken(tokens: ConnectionTokens): Promise<TokenExchangeResult> {
    if (!(await isRealYoutubeEnabled())) {
      return { accessToken: tokens.accessToken, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    }
    if (!tokens.refreshToken) throw new Error('YouTube: no refresh_token stored to refresh.');
    // Google returns a new access token but keeps the same refresh_token.
    const r = await httpJson<{ access_token: string; expires_in?: number }>({
      method: 'POST',
      url: YT_TOKEN_URL,
      platform: 'youtube',
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: env.YOUTUBE_CLIENT_ID,
        client_secret: env.YOUTUBE_CLIENT_SECRET,
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
    };
  },
};
