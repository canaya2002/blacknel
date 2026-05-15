import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE_NAME, verifySession } from '@/lib/auth/cookie';

/**
 * Root middleware (Vercel Routing Middleware / Next.js middleware).
 *
 * Phase 1 responsibilities:
 *   - Best-effort session validation. If the cookie is malformed,
 *     drop it so the user lands on `/login` cleanly instead of looping.
 *   - Route protection: unauthenticated traffic into `/(app)/*` and
 *     adjacent app-only paths is redirected to `/login`. Public marketing
 *     routes and `/auth/*` callbacks stay open.
 *
 * Phase 11 expands this to refresh Supabase Auth tokens before they
 * expire. Until then, the cookie is self-contained (JWT) — no refresh
 * roundtrip required.
 */

const PUBLIC_PATHS = ['/', '/pricing', '/login', '/signup', '/feedback'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // /feedback/<token> public landing pages (Phase 5).
  if (pathname.startsWith('/feedback/')) return true;
  if (pathname.startsWith('/auth/')) return true;
  return false;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
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
