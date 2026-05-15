import 'server-only';

import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';

import { dbAs } from '@/lib/db/client';
import {
  type Brand,
  brands,
  type Location,
  locations,
} from '@/lib/db/schema';
import type { Session } from '@/lib/auth/types';

import { CONTEXT_COOKIE_NAME } from './constants';

export { CONTEXT_COOKIE_NAME };

export interface BrandLocationContext {
  brand: { id: string; slug: string; name: string };
  location: { id: string; slug: string; name: string } | null;
}

interface RawCookie {
  brandSlug?: string;
  locationSlug?: string;
}

function parseCookie(raw: string | undefined): RawCookie {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return {
      brandSlug: typeof parsed.brandSlug === 'string' ? parsed.brandSlug : undefined,
      locationSlug:
        typeof parsed.locationSlug === 'string' ? parsed.locationSlug : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Resolve the current brand + location context for an authenticated
 * session. Priority order:
 *
 *   1. URL search params (`?brand=<slug>&location=<slug>`) — sticky-linking
 *      a teammate to a specific scope wins.
 *   2. Cookie `blacknel_context` — last selection in this browser.
 *   3. Fallback: first brand of the org, no location.
 *
 * Returns `null` for the whole context when the org has zero brands
 * (a fresh tenant before onboarding). Callers handle that as the
 * "you need to set up a brand first" state.
 *
 * Goes through `runAdmin` because the brand list is sized by *org*, not
 * by the user's role within the org. We're not exposing rows, only
 * resolving the user's current scope.
 */
export async function resolveBrandLocationContext(
  session: Session,
  searchParams?: { brand?: string | string[]; location?: string | string[] },
): Promise<BrandLocationContext | null> {
  const urlBrandSlug = first(searchParams?.brand);
  const urlLocationSlug = first(searchParams?.location);

  const cookieStore = await cookies();
  const cookie = parseCookie(cookieStore.get(CONTEXT_COOKIE_NAME)?.value);

  const desiredBrandSlug = urlBrandSlug ?? cookie.brandSlug;
  const desiredLocationSlug = urlLocationSlug ?? cookie.locationSlug;

  // Brand resolution is scoped to the user's org. We use dbAs so RLS
  // confirms the user is allowed to see the brand at all.
  const brandRows = await dbAs<Brand[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => tx.select().from(brands).orderBy(brands.name),
  );

  if (brandRows.length === 0) return null;

  const chosenBrand =
    (desiredBrandSlug && brandRows.find((b: Brand) => b.slug === desiredBrandSlug)) ||
    brandRows[0]!;

  // Locations of the chosen brand. RLS already filtered by org.
  const locationRows = await dbAs<Location[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select()
        .from(locations)
        .where(eq(locations.brandId, chosenBrand.id))
        .orderBy(locations.name),
  );

  const chosenLocation = desiredLocationSlug
    ? locationRows.find((l: Location) => slugify(l.name) === desiredLocationSlug) ?? null
    : null;

  return {
    brand: {
      id: chosenBrand.id,
      slug: chosenBrand.slug,
      name: chosenBrand.name,
    },
    location: chosenLocation
      ? {
          id: chosenLocation.id,
          slug: slugify(chosenLocation.name),
          name: chosenLocation.name,
        }
      : null,
  };
}

/**
 * List every brand + their locations for the current session. Used by
 * the topbar switcher.
 */
export async function listBrandsAndLocations(session: Session): Promise<
  Array<{
    id: string;
    slug: string;
    name: string;
    locations: Array<{ id: string; slug: string; name: string }>;
  }>
> {
  const brandRows = await dbAs<Brand[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => tx.select().from(brands).orderBy(brands.name),
  );
  const locationRows = await dbAs<Location[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) => tx.select().from(locations).orderBy(locations.name),
  );

  return brandRows.map((b: Brand) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    locations: locationRows
      .filter((l: Location) => l.brandId === b.id)
      .map((l: Location) => ({ id: l.id, slug: slugify(l.name), name: l.name })),
  }));
}

/**
 * Persist the chosen context to the cookie so the next request resolves
 * to the same scope even without URL params.
 */
export async function writeBrandLocationCookie(
  brandSlug: string,
  locationSlug: string | null,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    CONTEXT_COOKIE_NAME,
    JSON.stringify({ brandSlug, locationSlug }),
    {
      httpOnly: false, // client-readable so the UI can highlight active scope without a fetch
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    },
  );
}

// ---- helpers ---------------------------------------------------------

function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

