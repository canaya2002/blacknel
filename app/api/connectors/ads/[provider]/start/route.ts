import { NextResponse } from 'next/server';

import { getAdsOAuthProvider } from '@/lib/connectors/ads-oauth/providers';
import { signOAuthState } from '@/lib/connectors/oauth-state';
import { env } from '@/lib/env';
import { requireUser } from '@/lib/auth/server';
import { authorize } from '@/lib/permissions/can';

// Node runtime + dynamic: reads the session cookie, signs encrypted state.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ads OAuth start (C51) — Google Ads / TikTok Ads. Signs a CSRF state bound to
 * the session and redirects to the platform consent dialog (real) or bounces to
 * our callback (mock, flag off) so dev/preview exercise the flow. Gated on
 * `ads:manage`.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  const session = await requireUser();
  authorize(session.role, 'ads:manage');

  const cfg = getAdsOAuthProvider(provider);
  const appUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  if (!cfg) {
    return NextResponse.redirect(new URL('/ads?ads=unknown_provider', appUrl).toString());
  }

  const redirectUri = `${appUrl}/api/connectors/ads/${provider}/callback`;
  const state = signOAuthState({ orgId: session.orgId, userId: session.userId, platform: provider });

  if (await cfg.isReal()) {
    return NextResponse.redirect(cfg.buildAuthUrl(state, redirectUri));
  }
  const cb = new URL(`/api/connectors/ads/${provider}/callback`, appUrl);
  cb.searchParams.set('state', state);
  cb.searchParams.set('mock', '1');
  return NextResponse.redirect(cb.toString());
}
