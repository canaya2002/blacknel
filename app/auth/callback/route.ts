import { type NextRequest, NextResponse } from 'next/server';

import { createSupabaseServerClient } from '@/lib/auth/supabase-server';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * Phase 11 / Commit 42a — Supabase magic-link callback.
 *
 * Receives `?code=<auth_code>&next=<relative_path>` from the link the
 * user clicked in their inbox. The code is single-use and short-lived.
 * `exchangeCodeForSession` validates it with Supabase Auth, writes the
 * session cookies via the cookie adapter, and we redirect on to `next`.
 *
 * Error handling: any failure (expired code, replay, wrong domain)
 * bounces back to `/login` with `?error=callback_failed`. The /login
 * page doesn't currently render that error string — it's there for
 * Sentry breadcrumbs and future UI polish.
 *
 * # Open-redirect safety
 *
 * `next` is validated to be a relative path beginning with `/` and not
 * `//`. Absolute URLs / protocol-relative URLs are rejected and fall
 * back to `/dashboard`. The same check exists in `sendMagicLinkAction`
 * — re-validating here is belt-and-suspenders because the magic link
 * itself can be hand-crafted.
 *
 * # Why a Route Handler, not a Server Action
 *
 * The user lands here via an `<a href>` click from the email client.
 * Server Actions are POST-only. A GET route handler is the right shape.
 */

function sanitizeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  if (!raw.startsWith('/')) return '/dashboard';
  if (raw.startsWith('//')) return '/dashboard';
  if (raw.length > 512) return '/dashboard';
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const next = sanitizeNext(url.searchParams.get('next'));

  if (!env.BLACKNEL_USE_REAL_AUTH) {
    // Mock path: the dev login Server Action handles cookie setup
    // directly. If somebody hits /auth/callback under flag=mock the
    // most useful response is "go back to /login".
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (!code) {
    log.warn({ url: url.pathname }, 'auth.callback.missing_code');
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'missing_code');
    return NextResponse.redirect(loginUrl);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    log.warn({ err: error }, 'auth.callback.exchange_failed');
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'callback_failed');
    return NextResponse.redirect(loginUrl);
  }

  log.info({ next }, 'auth.callback.success');
  return NextResponse.redirect(new URL(next, request.url));
}
