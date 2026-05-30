import 'server-only';

import { env } from '@/lib/env';

import { httpJson } from '../http';
import type { ManagedAccount, OAuthProvider, TokenExchangeResult } from '../oauth/types';
import type { ConnectionTokens } from '../tokens';

import {
  GBP_ACCOUNT_API,
  GBP_AUTH_URL,
  GBP_INFO_API,
  GBP_SCOPES,
  GBP_TOKEN_URL,
  isRealGbpEnabled,
} from './config';

/**
 * Google Business Profile OAuth provider (C49). Connects each business LOCATION
 * the user manages as a connected_accounts row — external id is the location
 * resource name `accounts/{a}/locations/{l}` (used by the reviews + local-posts
 * APIs). access_type=offline + prompt=consent so we always get a refresh_token.
 * Mock returns fake locations.
 */
export const gbpOAuth: OAuthProvider = {
  platform: 'gbp',
  isRealEnabled: isRealGbpEnabled,

  buildAuthUrl(state, redirectUri) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.GBP_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      scope: GBP_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GBP_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri): Promise<TokenExchangeResult> {
    if (!(await isRealGbpEnabled())) {
      return { accessToken: `mock-gbp-token-${code.slice(0, 6) || 'dev'}`, expiresAt: null };
    }
    const r = await httpJson<{ access_token: string; refresh_token?: string; expires_in?: number }>({
      method: 'POST',
      url: GBP_TOKEN_URL,
      platform: 'gbp',
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: env.GBP_CLIENT_ID,
        client_secret: env.GBP_CLIENT_SECRET,
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? null,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
    };
  },

  async listAccounts(tokens): Promise<ManagedAccount[]> {
    if (!(await isRealGbpEnabled())) {
      const seed = tokens.accessToken.slice(-6) || 'dev';
      return [
        {
          platform: 'gbp',
          externalId: `accounts/mock-${seed}/locations/loc-${seed}`,
          name: 'Mock Business Location',
          handle: null,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
          metadata: { locationTitle: 'Mock Business Location' },
        },
      ];
    }

    const headers = { authorization: `Bearer ${tokens.accessToken}` };
    const accounts = await httpJson<{ accounts?: Array<{ name: string; accountName?: string }> }>({
      method: 'GET',
      url: `${GBP_ACCOUNT_API}/accounts`,
      platform: 'gbp',
      headers,
    });

    const out: ManagedAccount[] = [];
    for (const acct of accounts.accounts ?? []) {
      const locs = await httpJson<{ locations?: Array<{ name: string; title?: string }> }>({
        method: 'GET',
        url: `${GBP_INFO_API}/${acct.name}/locations?readMask=name,title&pageSize=100`,
        platform: 'gbp',
        headers,
      });
      for (const loc of locs.locations ?? []) {
        // Reviews/posts APIs use the full accounts/{a}/locations/{l} resource.
        const locId = loc.name.startsWith('locations/') ? loc.name.slice('locations/'.length) : loc.name;
        out.push({
          platform: 'gbp',
          externalId: `${acct.name}/locations/${locId}`,
          name: loc.title ?? acct.accountName ?? 'Business Location',
          handle: null,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
          metadata: { locationTitle: loc.title ?? null },
        });
      }
    }
    return out;
  },

  async refreshAccessToken(tokens: ConnectionTokens): Promise<TokenExchangeResult> {
    if (!(await isRealGbpEnabled())) {
      return { accessToken: tokens.accessToken, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    }
    if (!tokens.refreshToken) throw new Error('GBP: no refresh_token stored to refresh.');
    const r = await httpJson<{ access_token: string; expires_in?: number }>({
      method: 'POST',
      url: GBP_TOKEN_URL,
      platform: 'gbp',
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: env.GBP_CLIENT_ID,
        client_secret: env.GBP_CLIENT_SECRET,
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
    };
  },
};
