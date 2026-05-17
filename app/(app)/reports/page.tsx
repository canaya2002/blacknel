import { AdsSection } from '@/components/reports/ads-section';
import { InboxSection } from '@/components/reports/inbox-section';
import { OverviewSection } from '@/components/reports/overview-section';
import { PublishingSection } from '@/components/reports/publishing-section';
import { ReportFilterBar } from '@/components/reports/report-filter-bar';
import { ReportTabNav } from '@/components/reports/report-tab-nav';
import { ScheduledSection } from '@/components/reports/scheduled-section';
import { SectionPlaceholder } from '@/components/reports/section-empty-states';
import { PageHeader } from '@/components/common/page-header';
import { requireUser } from '@/lib/auth/server';
import { withReportsCache } from '@/lib/reports/cache';
import { parseReportFilters } from '@/lib/reports/period';
import { loadAdsReport } from '@/lib/reports/ads-queries';
import { loadInboxReport } from '@/lib/reports/inbox-queries';
import { loadPublishingReport } from '@/lib/reports/publishing-queries';
import { loadOverviewReport } from '@/lib/reports/queries';
import { listScheduledReports } from '@/lib/scheduled-reports/queries';
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

  const now = new Date();
  const [brandOptions, payload, adsPayload, inboxPayload, publishingPayload] =
    await Promise.all([
      dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
        listBrandOptionsWithTx(tx, session.orgId),
      ),
      filters.section === 'overview'
        ? withReportsCache(
            {
              orgId: session.orgId,
              section: 'overview',
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
                now,
              }),
          )
        : Promise.resolve(null),
      filters.section === 'ads' && can(session.role, 'ads:read')
        ? withReportsCache(
            {
              orgId: session.orgId,
              section: 'ads',
              period: filters.period,
              brandId: filters.brandId,
            },
            filters.fresh,
            () =>
              loadAdsReport({
                orgId: session.orgId,
                userId: session.userId,
                period: filters.period,
                brandId: filters.brandId,
                now,
              }),
          )
        : Promise.resolve(null),
      filters.section === 'inbox' && can(session.role, 'inbox:read')
        ? withReportsCache(
            {
              orgId: session.orgId,
              section: 'inbox',
              period: filters.period,
              brandId: filters.brandId,
            },
            filters.fresh,
            () =>
              loadInboxReport({
                orgId: session.orgId,
                userId: session.userId,
                period: filters.period,
                brandId: filters.brandId,
                now,
              }),
          )
        : Promise.resolve(null),
      filters.section === 'publishing' && can(session.role, 'posts:read')
        ? withReportsCache(
            {
              orgId: session.orgId,
              section: 'publishing',
              period: filters.period,
              brandId: filters.brandId,
            },
            filters.fresh,
            () =>
              loadPublishingReport({
                orgId: session.orgId,
                userId: session.userId,
                period: filters.period,
                brandId: filters.brandId,
                now,
              }),
          )
        : Promise.resolve(null),
    ]);

  const canExport = can(session.role, 'reports:export');
  const carry = new URLSearchParams();
  carry.set('period', filters.period);
  if (filters.brandId) carry.set('brandId', filters.brandId);

  // Scheduled-reports tab (Phase 9 / Commit 34, D-34-6 a). Loaded
  // only when the user is on this section to avoid the extra query
  // on every Overview / Inbox / Publishing view.
  const scheduledReports =
    filters.section === 'scheduled'
      ? await listScheduledReports({
          orgId: session.orgId,
          userId: session.userId,
        })
      : [];
  const canManageScheduled = can(session.role, 'scheduled_reports:manage');

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
        {filters.section === 'overview' && payload ? (
          <OverviewSection
            payload={payload}
            period={filters.period}
            brandId={filters.brandId}
            canExport={canExport}
          />
        ) : filters.section === 'ads' && adsPayload ? (
          <AdsSection
            payload={adsPayload}
            period={filters.period}
            brandId={filters.brandId}
            canExport={canExport}
          />
        ) : filters.section === 'inbox' && inboxPayload ? (
          <InboxSection
            payload={inboxPayload}
            period={filters.period}
            brandId={filters.brandId}
            canExport={canExport}
          />
        ) : filters.section === 'publishing' && publishingPayload ? (
          <PublishingSection
            payload={publishingPayload}
            period={filters.period}
            brandId={filters.brandId}
            canExport={canExport}
          />
        ) : filters.section === 'scheduled' ? (
          <ScheduledSection
            reports={scheduledReports}
            canManage={canManageScheduled}
          />
        ) : filters.section === 'overview' ? null : filters.section === 'ai' ? (
          <SectionPlaceholder section="ai" />
        ) : (
          <SectionPlaceholder section={filters.section} />
        )}
      </div>
    </div>
  );
}
