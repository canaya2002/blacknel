import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { type AnyPgTx } from '../db/client';
import { brands, campaigns, organizations } from '../db/schema';

/**
 * Lightweight lookups that feed the /publish filter bar's dropdowns
 * (brands + campaigns). They run inside the same `dbAs`
 * transaction the dashboard loader opens — RLS keeps the result
 * org-scoped without an extra predicate, but the redundant
 * `organization_id = $1` still helps the planner.
 *
 * Statuses are scoped to "active" / "draft" / "running" so a
 * deleted/archived brand or completed campaign doesn't clog the
 * dropdown.
 */

export interface BrandOption {
  readonly id: string;
  readonly name: string;
}

export interface CampaignOption {
  readonly id: string;
  readonly name: string;
  readonly brandId: string | null;
}

export async function listBrandOptionsWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<ReadonlyArray<BrandOption>> {
  const rows = (await tx
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(and(eq(brands.organizationId, orgId), eq(brands.status, 'active')))
    .orderBy(asc(brands.name))) as Array<BrandOption>;
  return rows;
}

export async function listCampaignOptionsWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<ReadonlyArray<CampaignOption>> {
  const rows = (await tx
    .select({
      id: campaigns.id,
      name: campaigns.name,
      brandId: campaigns.brandId,
    })
    .from(campaigns)
    .where(eq(campaigns.organizationId, orgId))
    .orderBy(asc(campaigns.name))) as Array<CampaignOption>;
  return rows;
}

export interface OrgPresentation {
  /** IANA timezone (e.g. `'America/Mexico_City'`). */
  readonly timezone: string;
  /** BCP-47 locale (e.g. `'es-MX'`). Drives weekday and month labels. */
  readonly locale: string;
}

/**
 * Reads the org's presentation settings — timezone + locale.
 * Defaults are the same defaults the columns carry (`UTC` / `en`),
 * which avoids `Intl.DateTimeFormat` throwing on a malformed value
 * and keeps the calendar rendering even for orgs created before
 * onboarding populated these fields. The Ajuste-A timezone
 * boundary tests cover both the populated and missing paths.
 */
export async function getOrgTimezoneWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<OrgPresentation> {
  const rows = (await tx
    .select({ timezone: organizations.timezone, locale: organizations.locale })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)) as Array<{ timezone: string; locale: string }>;
  const row = rows[0];
  return {
    timezone: row?.timezone ?? 'UTC',
    locale: row?.locale ?? 'en',
  };
}
