import 'server-only';

import { env } from '@/lib/env';

import type { ConnectionTokens } from '../tokens';
import type { TokenExchangeResult } from '../oauth/types';

import { isRealMetaEnabled } from './config';
import { graphRequest } from './graph';

/**
 * Per-token Meta refresh (C46→C48). Long-lived Page tokens last ~60 days; this
 * re-derives one before it lapses. Real path calls Graph's fb_exchange_token;
 * mock extends the expiry (no network). The system-wide scan + cron now live in
 * the generic connector refresh (lib/connectors/refresh.ts), which dispatches
 * facebook/instagram here and the batch-2 platforms to their OAuthProvider.
 */

const MOCK_EXTENSION_MS = 60 * 24 * 60 * 60 * 1000; // mock: +60d

export async function refreshMetaToken(tokens: ConnectionTokens): Promise<TokenExchangeResult> {
  if (!(await isRealMetaEnabled())) {
    return { accessToken: tokens.accessToken, expiresAt: new Date(Date.now() + MOCK_EXTENSION_MS).toISOString() };
  }
  const long = await graphRequest<{ access_token: string; expires_in?: number }>({
    method: 'GET',
    path: '/oauth/access_token',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: tokens.accessToken,
    },
  });
  return {
    accessToken: long.access_token,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
  };
}
