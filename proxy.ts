import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, verifySession } from '@/lib/auth/cookie';
import { getKillSwitchState, shouldBlock } from '@/lib/kill-switch/check';

/**
 * Root proxy (Vercel Routing Middleware / Next.js 16 proxy.ts).
 *
 * Order of checks (highest priority first):
 *
 *   1. **Kill switch** (Phase 11 / Commit 40) — global maintenance
 *      switch. If active, every non-bypassed request returns 503 +
 *      Retry-After OR redirects HTML requests to `/maintenance`.
 *      Procedure: `doc/runbooks/kill-switch.md`.
 *
 *   2. **Session validation** (Phase 1) — best-effort. Malformed
 *      cookie → dropped so user lands on `/login` cleanly.
 *
 *   3. **Route protection** (Phase 1) — unauthenticated traffic
 *      into `/(app)/*` redirects to `/login`. Public marketing
 *      routes and `/auth/*` callbacks stay open.
 *
 * Phase 11 expands this to refresh Supabase Auth tokens before
 * they expire. Until then, the cookie is self-contained (JWT) —
 * no refresh roundtrip required.
 */

const PUBLIC_PATHS = ['/', '/pricing', '/login', '/signup', '/feedback'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // /feedback/<token> public landing pages (Phase 5).
  if (pathname.startsWith('/feedback/')) return true;
  if (pathname.startsWith('/auth/')) return true;
  return false;
}

function maintenanceResponse(
  request: NextRequest,
  state: 'read-only' | 'true',
): NextResponse {
  const accept = request.headers.get('accept') ?? '';
  const wantsHtml = accept.includes('text/html');
  if (wantsHtml) {
    const url = request.nextUrl.clone();
    url.pathname = '/maintenance';
    url.search = '';
    return NextResponse.redirect(url, { status: 307 });
  }
  return NextResponse.json(
    {
      error: 'MAINTENANCE',
      message:
        state === 'read-only'
          ? 'Write operations are temporarily disabled during a maintenance window. Reads continue to work.'
          : 'Service is in maintenance mode. Try again shortly.',
      retryAfterSeconds: 300,
    },
    {
      status: 503,
      headers: { 'Retry-After': '300', 'Cache-Control': 'no-store' },
    },
  );
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // (1) Kill switch — runs FIRST so a wedged DB / Auth doesn't block
  // the operator's ability to cut traffic. State + path + method are
  // the only inputs; no I/O.
  const killSwitchState = getKillSwitchState();
  if (
    killSwitchState !== 'false' &&
    shouldBlock({
      state: killSwitchState,
      pathname,
      method: request.method,
    })
  ) {
    return maintenanceResponse(request, killSwitchState);
  }

  // (2) Session validation.
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;

  // Drop a broken cookie so the next request starts clean. We can't
  // edit the *incoming* cookies map, only the response; the next round
  // trip will see no cookie.
  if (sessionCookie && !session) {
    const response = NextResponse.next();
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!session) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

/**
 * Skip middleware on static assets, API routes that handle their own
 * auth (webhooks, Inngest), and Next internals. Pages and Server
 * Action endpoints flow through.
 */
export const config = {
  matcher: [
    '/((?!api/webhooks|api/inngest|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
};
