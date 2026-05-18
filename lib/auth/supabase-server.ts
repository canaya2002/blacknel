import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { env } from '../env';

/**
 * Phase 11 / Commit 42a — Supabase server client helper.
 *
 * Wraps `@supabase/ssr`'s `createServerClient` with our cookie adapter.
 * Used by `getClaims()` (the read path) and by Server Actions that
 * issue magic links / handle the auth callback.
 *
 * # Why @supabase/ssr (not @supabase/auth-helpers-nextjs)
 *
 * `auth-helpers-nextjs` is deprecated. `@supabase/ssr` is the official
 * SSR-compatible client for Next.js App Router. It handles JWT
 * signature verification (via JWKS), session refresh, and cookie
 * storage so we don't reinvent any of those.
 *
 * # Cookie adapter quirk on Next 16
 *
 * `cookies()` is async in Next 16. The `getAll` adapter awaits the
 * cookie store; `setAll` re-awaits because each setter is independent.
 * Inside Server Components (read-only path), `setAll` is a no-op —
 * Next 16 throws if you try to mutate cookies in a Server Component.
 * The errors are swallowed because @supabase/ssr calls setAll
 * speculatively to refresh tokens; if we're in a read-only context
 * the refresh is deferred to the middleware (`proxy.ts`).
 *
 * # Public auth API stability
 *
 * Callers of `getSession()` / `requireUser()` / `requireOrg()` /
 * `requirePermission()` never see this client. The branching lives
 * in `lib/auth/server.ts`. This file is an implementation detail of
 * the `BLACKNEL_USE_REAL_AUTH=true` code path.
 */

export type BlacknelSupabaseClient = SupabaseClient;

export async function createSupabaseServerClient(): Promise<BlacknelSupabaseClient> {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase auth requires NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Set them in .env.local or flip BLACKNEL_USE_REAL_AUTH back to false.',
    );
  }

  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: ReadonlyArray<{
            name: string;
            value: string;
            options: CookieOptions;
          }>,
        ) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components are read-only on cookies in Next 16.
            // `proxy.ts` handles token refresh by calling `updateSession()`
            // before the request reaches the Server Component tree, so the
            // swallow here is intentional: callers in read-only contexts
            // already have a fresh cookie from the middleware pass.
          }
        },
      },
    },
  );
}
