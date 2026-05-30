import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { handleCallback } from '@/lib/connectors/oauth/flow';
import { getOAuthProvider } from '@/lib/connectors/oauth/registry';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { authorize } from '@/lib/permissions/can';
import { getOrgPlanCode } from '@/lib/queries/plan';

// Node runtime + always-dynamic: reads cookies (auth), decrypts state, calls the
// platform API, writes encrypted tokens.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generic OAuth callback for batch-2 connectors (C47). Validates the signed state
 * against the live session (CSRF + cross-tenant), exchanges the code, lists +
 * persists accounts with encrypted tokens. Redirects to /integrations with a
 * status. Tokens never reach the client.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await ctx.params;
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');

  const url = new URL(request.url);
  const back = (status: string): Response =>
    NextResponse.redirect(
      new URL(`/integrations?${provider}=${status}`, env.NEXT_PUBLIC_APP_URL).toString(),
    );

  if (!getOAuthProvider(provider)) return back('unknown_provider');

  try {
    const planCode = await getOrgPlanCode(session);
    const r = await handleCallback({
      orgId: session.orgId,
      userId: session.userId,
      planCode,
      platform: provider,
      params: {
        state: url.searchParams.get('state'),
        code: url.searchParams.get('code'),
        error: url.searchParams.get('error'),
      },
    });
    if (r.kind !== 'ok') return back(r.kind);
    if (r.result.accountIds.length === 0) {
      return back(r.result.skippedForPlan > 0 ? 'plan_limit' : 'no_accounts');
    }
    return back(`connected_${r.result.accountIds.length}`);
  } catch (err) {
    log.error({ provider, err: (err as Error).message }, 'connector.oauth.callback_failed');
    return back('error');
  }
}
