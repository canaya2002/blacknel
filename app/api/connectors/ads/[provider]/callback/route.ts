import { NextResponse } from 'next/server';

import { persistAdsConnection } from '@/lib/connectors/ads-connection-store';
import { getAdsOAuthProvider } from '@/lib/connectors/ads-oauth/providers';
import { verifyOAuthState } from '@/lib/connectors/oauth-state';
import { env } from '@/lib/env';
import { requireUser } from '@/lib/auth/server';
import { log } from '@/lib/log';
import { authorize } from '@/lib/permissions/can';

// Node runtime + dynamic: reads cookies, decrypts state, exchanges + persists tokens.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ads OAuth callback (C51) — Google Ads / TikTok Ads. Validates the signed state
 * against the live session (CSRF + cross-tenant), exchanges the code, and
 * persists the ad-platform connection (encrypted token, no seat gate). Ad
 * accounts are discovered on the next ads-sync tick (or via "sync ads now").
 * Redirects to /ads with a status. Tokens never reach the client.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  const session = await requireUser();
  authorize(session.role, 'ads:manage');

  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  const back = (status: string): Response =>
    NextResponse.redirect(new URL(`/ads?${provider}=${status}`, appUrl).toString());

  const cfg = getAdsOAuthProvider(provider);
  if (!cfg) return back('unknown_provider');

  const url = new URL(request.url);
  if (url.searchParams.get('error')) return back('denied');

  const state = url.searchParams.get('state');
  const verified = state ? verifyOAuthState(state) : null;
  if (!verified || verified.platform !== provider) return back('invalid_state');
  if (verified.orgId !== session.orgId || verified.userId !== session.userId) {
    return back('state_mismatch');
  }

  try {
    const redirectUri = `${appUrl}/api/connectors/ads/${provider}/callback`;
    const tokens = await cfg.exchange(url.searchParams.get('code') ?? 'mock', redirectUri);
    await persistAdsConnection(cfg.connectionPlatform, {
      orgId: session.orgId,
      userId: session.userId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      expiresAt: tokens.expiresAt,
      displayName: cfg.displayName,
    });
    return back('connected');
  } catch (err) {
    log.error({ provider, err: (err as Error).message }, 'ads.oauth.callback_failed');
    return back('error');
  }
}
