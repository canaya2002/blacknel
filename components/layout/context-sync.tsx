'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { CONTEXT_COOKIE_NAME } from '@/lib/context/constants';

/**
 * Mirrors the `?brand=…&location=…` URL params into the
 * `blacknel_context` cookie so the *next* session (a fresh tab tomorrow)
 * lands on the same scope without a URL hint. The server-side resolver
 * reads URL first, cookie second.
 *
 * Rendered once in the (app) layout. No-op during SSR; runs in
 * `useEffect` whenever the URL params change.
 */
export function BrandLocationCookieSync(): null {
  const params = useSearchParams();

  useEffect(() => {
    const brandSlug = params.get('brand');
    const locationSlug = params.get('location');
    if (!brandSlug && !locationSlug) return;
    const payload = JSON.stringify({
      brandSlug: brandSlug ?? undefined,
      locationSlug: locationSlug ?? undefined,
    });
    const year = 60 * 60 * 24 * 365;
    document.cookie = `${CONTEXT_COOKIE_NAME}=${encodeURIComponent(payload)}; path=/; max-age=${year}; samesite=lax`;
  }, [params]);

  return null;
}
