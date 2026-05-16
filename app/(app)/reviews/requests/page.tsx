import { asc, eq } from 'drizzle-orm';

import { PageHeader } from '@/components/common/page-header';
import { NewRequestForm } from '@/components/reviews/new-request-form';
import { RequestsKpis } from '@/components/reviews/requests-kpis';
import { RequestsList } from '@/components/reviews/requests-list';
import { requireUser } from '@/lib/auth/server';
import { dbAs } from '@/lib/db/client';
import { brands, locations } from '@/lib/db/schema';
import { authorize } from '@/lib/permissions/can';
import { loadReviewRequestsDashboard } from '@/lib/reviews/request-queries';

export const dynamic = 'force-dynamic';

/**
 * /reviews/requests — Commit 16.
 *
 * Single-pass loader (same pattern as /reputation): the page does
 * one `loadReviewRequestsDashboard` call + one `locations` lookup
 * for the new-request form, and renders presentational components
 * on the result.
 *
 * Bulk send (CSV upload) is the Enterprise-tier feature flagged for
 * Phase 12 — the page surface here covers single-recipient send,
 * the list of in-flight + decided requests, and cancellation.
 */
export default async function ReviewRequestsPage(): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'reviews:reply');

  const [dashboard, locationOptions] = await Promise.all([
    loadReviewRequestsDashboard({
      orgId: session.orgId,
      userId: session.userId,
    }),
    dbAs<
      Array<{
        brandId: string;
        brandName: string | null;
        locationId: string;
        locationName: string;
      }>
    >({ orgId: session.orgId, userId: session.userId }, async (tx) =>
      tx
        .select({
          brandId: locations.brandId,
          brandName: brands.name,
          locationId: locations.id,
          locationName: locations.name,
        })
        .from(locations)
        .leftJoin(brands, eq(brands.id, locations.brandId))
        .where(eq(locations.organizationId, session.orgId))
        .orderBy(asc(locations.name)),
    ),
  ]);

  const dropdownLocations = locationOptions
    .filter((l) => l.brandId !== null)
    .map((l) => ({
      brandId: l.brandId,
      locationId: l.locationId,
      label: `${l.brandName ?? '—'} · ${l.locationName}`,
    }));

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Review requests"
        description="Pide reseñas a tus clientes vía email. Cada solicitud lleva un token único de 30 días; rating ≥4 redirige al perfil público (Google/Yelp), rating ≤3 se captura privado para que tu equipo dé seguimiento."
      />

      <div className="flex flex-col gap-4 px-6 py-4">
        <RequestsKpis kpis={dashboard.kpis} />

        {dropdownLocations.length > 0 ? (
          <NewRequestForm locations={dropdownLocations} />
        ) : (
          <div className="rounded-md border border-dashed bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
            Para enviar review requests primero crea al menos una ubicación en
            /locations.
          </div>
        )}

        <RequestsList items={dashboard.items} />
      </div>
    </div>
  );
}
