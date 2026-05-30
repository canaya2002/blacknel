import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { persistMetaAccounts } from '@/lib/connectors/meta/connect';
import {
  exchangeCodeForTokens,
  listManagedAccounts,
  verifyState,
} from '@/lib/connectors/meta/oauth';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { authorize } from '@/lib/permissions/can';
import { getOrgPlanCode } from '@/lib/queries/plan';

// Node runtime + always-dynamic: reads cookies (auth), decrypts state, calls
// Graph, writes encrypted tokens.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta OAuth callback (C46). Validates the signed `state` against the live
 * session (CSRF + cross-tenant defence), exchanges the code for a long-lived
 * token, lists Pages + IG accounts, and persists them as connected_accounts with
 * encrypted tokens. Always redirects back to /integrations with a status. Tokens
 * never reach the client.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');

  const url = new URL(request.url);
  const back = (status: string): Response =>
    NextResponse.redirect(new URL(`/integrations?meta=${status}`, env.NEXT_PUBLIC_APP_URL).toString());

  if (url.searchParams.get('error')) return back('denied');

  const state = url.searchParams.get('state');
  const verified = state ? verifyState(state) : null;
  if (!verified) return back('invalid_state');
  // Bind the state to the live session — defends against CSRF + cross-tenant.
  if (verified.orgId !== session.orgId || verified.userId !== session.userId) {
    return back('state_mismatch');
  }

  try {
    const { userAccessToken, expiresAt } = await exchangeCodeForTokens(
      url.searchParams.get('code') ?? 'mock',
    );
    const accounts = await listManagedAccounts(userAccessToken);
    const planCode = await getOrgPlanCode(session);
    const result = await persistMetaAccounts({
      orgId: session.orgId,
      userId: session.userId,
      planCode,
      accounts,
    });
    // C50: persist the USER token as the `meta_ads` connection so the Marketing
    // API sync can use it (Pages persist only Page tokens). Best-effort — never
    // fail the content connect if this hiccups; ad accounts are discovered on the
    // next ads-sync tick (or via the manual "sync ads" action). ONLY on the real
    // path — the mock exchange returns a fake token, and persisting it would leave
    // a junk ads connection that the discovery sweep would later choke on.
    try {
      const { isRealMetaEnabled } = await import('@/lib/connectors/meta/config');
      if (await isRealMetaEnabled()) {
        const { persistMetaAdsConnection } = await import('@/lib/connectors/meta/ads-connection');
        await persistMetaAdsConnection({
          orgId: session.orgId,
          userId: session.userId,
          userAccessToken,
          expiresAt,
        });
      }
    } catch (cause) {
      log.warn({ err: (cause as Error).message }, 'meta.ads.connection_persist_failed');
    }
    if (result.connected === 0 && result.accountIds.length === 0) {
      return back(result.skippedForPlan > 0 ? 'plan_limit' : 'no_accounts');
    }
    return back(`connected_${result.accountIds.length}`);
  } catch (err) {
    log.error({ err: (err as Error).message }, 'meta.oauth.callback_failed');
    return back('error');
  }
}
