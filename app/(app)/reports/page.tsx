import { OverviewSection } from '@/components/reports/overview-section';
import { ReportFilterBar } from '@/components/reports/report-filter-bar';
import { ReportTabNav } from '@/components/reports/report-tab-nav';
import { SectionPlaceholder } from '@/components/reports/section-empty-states';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { withReportsCache } from '@/lib/reports/cache';
import { parseReportFilters } from '@/lib/reports/period';
import { loadOverviewReport } from '@/lib/reports/queries';
import { dbAs } from '@/lib/db/client';
import { authorize, can } from '@/lib/permissions/can';
import { listBrandOptionsWithTx } from '@/lib/publish/picker-data';

export const dynamic = 'force-dynamic';

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /reports — Phase 8 / Commit 27.
 *
 * Single-pass dashboard. URL-driven tab state
 * (`?section=overview|inbox|publishing|ai`), period filter
 * (`?period=7d|30d|90d`, default 30d per D-27-2), optional
 * brand scope (`?brandId`), `?fresh=1` bypasses the 60s LRU
 * cache (Ajuste 2).
 *
 * **Phase 8 charter rule.** This page only reads via
 * `lib/reports/*` — never touches Phase 1-7 schema or queries.
 */
export default async function ReportsPage({
  searchParams,
}: ReportsPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'reports:create');

  const sp = await searchParams;
  const filters = parseReportFilters(sp);

  const [brandOptions, payload] = await Promise.all([
    dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      listBrandOptionsWithTx(tx, session.orgId),
    ),
    withReportsCache(
      {
        orgId: session.orgId,
        section: filters.section,
        period: filters.period,
        brandId: filters.brandId,
      },
      filters.fresh,
      () =>
        loadOverviewReport({
          orgId: session.orgId,
          userId: session.userId,
          period: filters.period,
          brandId: filters.brandId,
          now: new Date(),
        }),
    ),
  ]);

  const canExport = can(session.role, 'reports:export');
  const carry = new URLSearchParams();
  carry.set('period', filters.period);
  if (filters.brandId) carry.set('brandId', filters.brandId);

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Reports"
        description="Cross-area KPIs con comparativa vs período anterior. Default 30d. Refresh bypassea el cache 60s."
      />

      <ReportFilterBar filters={filters} brandOptions={brandOptions} />
      <ReportTabNav
        current={filters.section}
        searchParamsCarry={carry.toString()}
      />

      <div className="flex flex-col gap-4 px-6 py-4">
        {filters.section === 'overview' ? (
          <OverviewSection
            payload={payload}
            period={filters.period}
            brandId={filters.brandId}
            canExport={canExport}
          />
        ) : (
          <SectionPlaceholder section={filters.section} />
        )}
      </div>
    </div>
  );
}
