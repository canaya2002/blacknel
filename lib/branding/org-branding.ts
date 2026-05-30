import 'server-only';

import { eq } from 'drizzle-orm';

import { type AnyPgTx } from '@/lib/db/client';
import { organizations } from '@/lib/db/schema';

/**
 * White-label org branding resolver (C52). Falls back to Blacknel defaults when
 * an org hasn't set its display name / colors / logo. `displayName` prefers the
 * dedicated column, then the org name, then 'Blacknel'. Colors are validated as
 * `#rrggbb`; anything else falls back to the default so a bad value can't break
 * the PDF renderer.
 */

export interface OrgBranding {
  readonly displayName: string;
  readonly logoUrl: string | null;
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly locale: 'es' | 'en';
}

const DEFAULT_PRIMARY = '#5b3df5';
const DEFAULT_SECONDARY = '#1f2328';
const DEFAULT_NAME = 'Blacknel';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function normalizeHex(value: string | null | undefined, fallback: string): string {
  return value && HEX_RE.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

export interface OrgBrandingRow {
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  locale: string | null;
}

export function resolveOrgBranding(row: OrgBrandingRow): OrgBranding {
  return {
    displayName: row.displayName?.trim() || row.name?.trim() || DEFAULT_NAME,
    logoUrl: row.logoUrl ?? null,
    primaryColor: normalizeHex(row.primaryColor, DEFAULT_PRIMARY),
    secondaryColor: normalizeHex(row.secondaryColor, DEFAULT_SECONDARY),
    locale: row.locale === 'es' ? 'es' : 'en',
  };
}

/** Read + resolve an org's branding under the caller's tx (RLS-scoped). */
export async function getOrgBranding(tx: AnyPgTx, orgId: string): Promise<OrgBranding> {
  const rows = (await tx
    .select({
      name: organizations.name,
      displayName: organizations.displayName,
      logoUrl: organizations.logoUrl,
      primaryColor: organizations.primaryColor,
      secondaryColor: organizations.secondaryColor,
      locale: organizations.locale,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)) as OrgBrandingRow[];
  const row = rows[0];
  if (!row) {
    return {
      displayName: DEFAULT_NAME,
      logoUrl: null,
      primaryColor: DEFAULT_PRIMARY,
      secondaryColor: DEFAULT_SECONDARY,
      locale: 'en',
    };
  }
  return resolveOrgBranding(row);
}
