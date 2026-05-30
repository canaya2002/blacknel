import 'server-only';

import { env } from '@/lib/env';

import { httpJson } from '../http';
import type { ManagedAccount, OAuthProvider, TokenExchangeResult } from '../oauth/types';
import type { ConnectionTokens } from '../tokens';

import {
  isRealLinkedinEnabled,
  LINKEDIN_API_BASE,
  LINKEDIN_API_VERSION,
  LINKEDIN_AUTH_URL,
  LINKEDIN_SCOPES,
  LINKEDIN_TOKEN_URL,
} from './config';

/**
 * LinkedIn OAuth 2.0 provider (C47). Connects the authenticated member plus any
 * Company Pages they administer (each persisted as a connected_accounts row with
 * the author URN as external id). Mock path returns a fake member + company.
 */
export const linkedinOAuth: OAuthProvider = {
  platform: 'linkedin',

  isRealEnabled: isRealLinkedinEnabled,

  buildAuthUrl(state, redirectUri) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.LINKEDIN_CLIENT_ID ?? '',
      redirect_uri: redirectUri,
      state,
      scope: LINKEDIN_SCOPES.join(' '),
    });
    return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(code, redirectUri): Promise<TokenExchangeResult> {
    if (!(await isRealLinkedinEnabled())) {
      return { accessToken: `mock-linkedin-token-${code.slice(0, 6) || 'dev'}`, expiresAt: null };
    }
    const r = await httpJson<{ access_token: string; expires_in?: number; refresh_token?: string }>({
      method: 'POST',
      url: LINKEDIN_TOKEN_URL,
      platform: 'linkedin',
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? null,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
    };
  },

  async listAccounts(tokens): Promise<ManagedAccount[]> {
    if (!(await isRealLinkedinEnabled())) {
      const seed = tokens.accessToken.slice(-6) || 'dev';
      return [
        {
          platform: 'linkedin',
          externalId: `urn:li:person:mock-${seed}`,
          name: 'Mock LinkedIn Member',
          handle: null,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
          metadata: { authorType: 'person' },
        },
        {
          platform: 'linkedin',
          externalId: `urn:li:organization:mock-${seed}`,
          name: 'Mock LinkedIn Company',
          handle: null,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          tokenExpiresAt: tokens.expiresAt,
          metadata: { authorType: 'organization' },
        },
      ];
    }

    const headers = { authorization: `Bearer ${tokens.accessToken}` };
    const me = await httpJson<{ sub: string; name?: string }>({
      method: 'GET',
      url: 'https://api.linkedin.com/v2/userinfo',
      platform: 'linkedin',
      headers,
    });
    const out: ManagedAccount[] = [
      {
        platform: 'linkedin',
        externalId: `urn:li:person:${me.sub}`,
        name: me.name ?? 'LinkedIn Member',
        handle: null,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        tokenExpiresAt: tokens.expiresAt,
        metadata: { authorType: 'person' },
      },
    ];
    // Company Pages the member administers (best-effort — needs org scopes).
    try {
      const orgs = await httpJson<{ elements?: Array<{ organizationalTarget?: string }> }>({
        method: 'GET',
        url: `${LINKEDIN_API_BASE}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`,
        platform: 'linkedin',
        headers: { ...headers, 'linkedin-version': LINKEDIN_API_VERSION },
      });
      for (const el of orgs.elements ?? []) {
        if (el.organizationalTarget) {
          out.push({
            platform: 'linkedin',
            externalId: el.organizationalTarget,
            name: 'LinkedIn Company Page',
            handle: null,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken ?? null,
            tokenExpiresAt: tokens.expiresAt,
            metadata: { authorType: 'organization' },
          });
        }
      }
    } catch {
      // Org listing is optional — a member with no admin orgs still connects.
    }
    return out;
  },

  async refreshAccessToken(tokens: ConnectionTokens): Promise<TokenExchangeResult> {
    if (!(await isRealLinkedinEnabled())) {
      return { accessToken: tokens.accessToken, expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString() };
    }
    if (!tokens.refreshToken) throw new Error('LinkedIn: no refresh_token stored to refresh.');
    const r = await httpJson<{ access_token: string; expires_in?: number; refresh_token?: string }>({
      method: 'POST',
      url: LINKEDIN_TOKEN_URL,
      platform: 'linkedin',
      form: {
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
        client_id: env.LINKEDIN_CLIENT_ID,
        client_secret: env.LINKEDIN_CLIENT_SECRET,
      },
    });
    return {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? tokens.refreshToken,
      expiresAt: r.expires_in ? new Date(Date.now() + r.expires_in * 1000).toISOString() : null,
    };
  },
};
