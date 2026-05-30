import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth/server';
import { useRealMeta } from '@/lib/connectors/meta/config';
import { buildAuthUrl, signState } from '@/lib/connectors/meta/oauth';
import { env } from '@/lib/env';
import { authorize } from '@/lib/permissions/can';

// Node runtime + always-dynamic: reads cookies (auth) + signs a CSRF state.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta OAuth start (C46). Authenticated; binds a signed `state` to the caller's
 * org+user. Real mode → redirect to Meta's OAuth dialog. Mock mode (useRealMeta
 * off) → bounce straight to our callback with a `mock` marker so dev/preview can
 * exercise the connect flow without a live Meta App.
 */
export async function GET(): Promise<Response> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');

  const state = signState({ orgId: session.orgId, userId: session.userId });

  if (await useRealMeta()) {
    return NextResponse.redirect(buildAuthUrl(state));
  }

  const cb = new URL('/api/connectors/meta/callback', env.NEXT_PUBLIC_APP_URL);
  cb.searchParams.set('state', state);
  cb.searchParams.set('mock', '1');
  return NextResponse.redirect(cb.toString());
}
