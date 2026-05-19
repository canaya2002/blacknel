import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, verifySession } from '@/lib/auth/cookie';
import { env } from '@/lib/env';
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
 *   2. **Session validation / refresh** — branches on
 *      `BLACKNEL_USE_REAL_AUTH`:
 *        - false → verify JOSE cookie (Phase 1-10 path).
 *        - true  → `@supabase/ssr` refreshes the access token if near
 *                  expiry and writes the rotated cookie on the response.
 *                  Validation is implicit: `auth.getUser()` returns null
 *                  on a tampered / expired cookie.
 *
 *   3. **Route protection** (Phase 1) — unauthenticated traffic
 *      into non-public routes redirects to `/login`. Marketing routes
 *      and `/auth/*` callbacks stay open.
 */

const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/login',
  '/signup',
  '/feedback',
  // Phase 11 / C40 — health endpoint, polled by external monitors
  // (UptimeRobot, Vercel uptime, etc). Must NOT redirect to /login;
  // returns kill-switch state + timestamp as JSON. The kill switch
  // bypass list (see lib/kill-switch/check.ts) already covers this
  // path for the maintenance check above — adding it here covers the
  // auth check that runs immediately after.
  '/api/health',
];

// Phase 11 — Meta App Review data-deletion callback. Meta posts to
// this URL without credentials (signature carries the trust); a 307 to
// /login fails their verification. The route validates HMAC-SHA256 of
// the body itself, so allowing it through the auth gate is safe — auth
// is at the signature layer, not the cookie layer. The dynamic /[code]
// status lookup uses the same prefix.
function isMetaDataDeletionPath(pathname: string): boolean {
  return pathname === '/api/meta/data-deletion' ||
    pathname.startsWith('/api/meta/data-deletion/');
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // /feedback/<token> public landing pages (Phase 5).
  if (pathname.startsWith('/feedback/')) return true;
  if (pathname.startsWith('/auth/')) return true;
  if (isMetaDataDeletionPath(pathname)) return true;
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

/**
 * Phase 11 / C42a — Supabase session refresh. Mirrors the official
 * `@supabase/ssr` middleware pattern: build a client that reads / writes
 * cookies on the incoming request + outgoing response, then call
 * `auth.getUser()` which silently rotates an expired access token using
 * the refresh token. Returns the user (or null) plus the prepared
 * response so the caller can decide where to send the request next.
 */
async function refreshSupabaseSession(request: NextRequest): Promise<{
  response: NextResponse;
  isAuthenticated: boolean;
}> {
  let response = NextResponse.next({ request });

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Misconfigured deploy: flag is on but Supabase URL/key missing. Fail
    // closed — treat as unauthenticated so the route-protection branch
    // bounces protected paths to /login (which will then show its own
    // error if BLACKNEL_USE_REAL_AUTH is set but unusable).
    return { response, isAuthenticated: false };
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: ReadonlyArray<{
            name: string;
            value: string;
            options: CookieOptions;
          }>,
        ) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, isAuthenticated: Boolean(user) };
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

  // (2) Session validation / refresh — branches by flag.
  if (env.BLACKNEL_USE_REAL_AUTH) {
    const { response, isAuthenticated } = await refreshSupabaseSession(request);

    if (isPublicPath(pathname)) {
      return response;
    }
    if (!isAuthenticated) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
    return response;
  }

  // Mock path (Phase 1-10): JOSE cookie verification.
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
