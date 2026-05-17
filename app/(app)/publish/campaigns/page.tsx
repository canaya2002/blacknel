import Link from 'next/link';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CampaignFilterBar } from '@/components/campaigns/campaign-filter-bar';
import { CampaignKpiCards } from '@/components/campaigns/campaign-kpi-cards';
import { CampaignsList } from '@/components/campaigns/campaigns-list';
import { CampaignsEmptyState } from '@/components/campaigns/empty-states';
import { requireUser } from '@/lib/auth/server';
import {
  getCampaignKpiCounts,
  listCampaigns,
} from '@/lib/campaigns/queries';
import { parseCampaignFilters, hasActiveCampaignFilters } from '@/lib/campaigns/filters';
import { decodeCampaignCursor } from '@/lib/campaigns/cursor';
import { dbAs } from '@/lib/db/client';
import { authorize, can } from '@/lib/permissions/can';
import {
  getOrgTimezoneWithTx,
  listBrandOptionsWithTx,
} from '@/lib/publish/picker-data';

export const dynamic = 'force-dynamic';

interface CampaignsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /publish/campaigns — Commit 21.
 *
 * Same dashboard pattern as /publish (Commit 18) and /inbox
 * (Commit 8): Server Component, single `dbAs` for the page-load
 * fan-out, URL-driven filters + cursor. Empty states branch on
 * whether the org has any campaigns + whether filters are active.
 */
export default async function CampaignsPage({
  searchParams,
}: CampaignsPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'campaigns:read');
  const params = await searchParams;
  const filters = parseCampaignFilters(params);
  const cursorRaw = typeof params.cursor === 'string' ? params.cursor : undefined;
  const cursor = decodeCampaignCursor(cursorRaw);

  const [kpis, page, brandOptions, presentation] = await Promise.all([
    getCampaignKpiCounts({ orgId: session.orgId, userId: session.userId }),
    listCampaigns({
      orgId: session.orgId,
      userId: session.userId,
      filters,
      cursor,
    }),
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      listBrandOptionsWithTx(tx, session.orgId),
    ),
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      getOrgTimezoneWithTx(tx, session.orgId),
    ),
  ]);

  const canCreate = can(session.role, 'campaigns:create');
  const hasFilters = hasActiveCampaignFilters(filters);
  const isEmpty = page.campaigns.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-card/30 px-6 py-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Campañas</h1>
          <p className="text-xs text-muted-foreground">
            Agrupa posts en torno a un objetivo. Cada campaña tiene fechas,
            estado de ciclo de vida, y opcionalmente un budget.
          </p>
        </div>
        {canCreate ? (
          <Button asChild size="sm">
            <Link href="/publish/campaigns/new" prefetch={false}>
              <Plus className="h-4 w-4" aria-hidden />
              Nueva campaña
            </Link>
          </Button>
        ) : null}
      </header>

      <div className="px-6">
        <CampaignKpiCards counts={kpis} />
      </div>

      <CampaignFilterBar filters={filters} brandOptions={brandOptions} />

      {isEmpty ? (
        <div className="px-6">
          <CampaignsEmptyState hasFilters={hasFilters} canCreate={canCreate} />
        </div>
      ) : (
        <CampaignsList
          campaigns={page.campaigns}
          nextCursor={page.nextCursor}
          timeZone={presentation.timezone}
          locale={presentation.locale}
        />
      )}
    </div>
  );
}
