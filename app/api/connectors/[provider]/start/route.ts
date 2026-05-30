import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { startOAuth } from '@/lib/connectors/oauth/flow';
import { getOAuthProvider } from '@/lib/connectors/oauth/registry';
import { authorize } from '@/lib/permissions/can';

// Node runtime + always-dynamic: reads cookies (auth) + signs a CSRF state.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generic OAuth start for batch-2 connectors (C47). `/api/connectors/<platform>/
 * start` → authed, binds a signed state to the caller's org+user, redirects to
 * the platform dialog (real) or our callback (mock). Meta keeps its own routes.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');

  if (!getOAuthProvider(provider)) {
    return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
  }

  const { redirectUrl } = await startOAuth({
    orgId: session.orgId,
    userId: session.userId,
    platform: provider,
  });
  return NextResponse.redirect(redirectUrl);
}
