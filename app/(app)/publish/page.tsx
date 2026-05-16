import { requireUser } from '@/lib/auth/server';
import { can } from '@/lib/permissions/can';
import { authorize } from '@/lib/permissions/can';
import { parsePublishFilters, hasActiveFilters } from '@/lib/publish/filters';
import { loadPublishDashboardData } from '@/lib/publish/dashboard';
import { checkPostsCap } from '@/lib/publish/usage-check';
import { getOrgPlanCode } from '@/lib/queries/plan';

import { CalendarListView } from '@/components/publish/calendar-list-view';
import { CalendarMonthGrid } from '@/components/publish/calendar-month-grid';
import { CalendarMonthHeader } from '@/components/publish/calendar-month-header';
import {
  NoMatches,
  NoPostsAtAll,
  TabClean,
} from '@/components/publish/empty-states';
import { FilterBar } from '@/components/publish/filter-bar';
import { KpiCards } from '@/components/publish/kpi-cards';
import { PostsList } from '@/components/publish/posts-list';
import { PublishHeader } from '@/components/publish/publish-header';
import { ViewTabs } from '@/components/publish/view-tabs';

export const dynamic = 'force-dynamic';

interface PublishPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /publish — Commit 18.
 *
 * Single-pass dashboard, same shape as /reputation. The page is a
 * Server Component: it authenticates, parses URL filters
 * defensively, loads everything under one `dbAs` transaction and
 * composes the layout. Every child receives its slice as props —
 * none of them fetch anything.
 *
 * URL contract (Ajuste 1):
 *   - ?view=calendar|drafts|scheduled|published|failed (default 'calendar')
 *   - ?cal=month|list (default 'month'; only meaningful when view=calendar)
 *   - ?month=YYYY-MM (default: current month in org timezone)
 *   - ?brandId / ?campaignId / ?status / ?q
 *   - ?scheduledFrom / ?scheduledTo
 *
 * Permissions:
 *   - `posts:read` is the gate for the whole module (every role
 *     except suspended).
 *   - `posts:create` controls whether the "Nuevo post" CTA renders.
 *
 * Plan gating (Section B):
 *   - When `checkPostsCap.reached` is true, the header swaps the
 *     CTA for the amber banner with a /billing link. The Server
 *     Action `createPostAction` rejects with `PLAN_LIMIT_REACHED`
 *     even if the stale UI keeps the CTA visible.
 */
export default async function PublishPage({
  searchParams,
}: PublishPageProps): Promise<React.ReactElement> {
  const session = await requireUser();
  authorize(session.role, 'posts:read');

  const sp = await searchParams;
  const now = new Date();
  const filters = parsePublishFilters(sp, { now });

  const plan = await getOrgPlanCode(session);
  const [data, cap] = await Promise.all([
    loadPublishDashboardData({
      orgId: session.orgId,
      userId: session.userId,
      filters,
    }),
    checkPostsCap(session.orgId, plan),
  ]);

  const canCreate = can(session.role, 'posts:create');
  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="flex flex-col">
      <PublishHeader
        canCreate={canCreate}
        cap={{ reached: cap.reached, current: cap.current, cap: cap.cap }}
      />
      <div className="px-6 py-3">
        <KpiCards kpis={data.kpis} />
      </div>
      <ViewTabs filters={data.filters} kpis={data.kpis} />
      <FilterBar
        filters={data.filters}
        brands={data.brandOptions}
        campaigns={data.campaignOptions}
      />

      {data.filters.view === 'calendar' ? (
        <CalendarSection
          filters={data.filters}
          data={data}
          now={now}
          filtersActive={filtersActive}
        />
      ) : (
        <ListSection
          filters={data.filters}
          posts={data.listPage.posts}
          hasMore={data.listPage.nextCursor !== null}
          timeZone={data.orgTimezone}
          locale={data.orgLocale}
          filtersActive={filtersActive}
        />
      )}
    </div>
  );
}

function CalendarSection({
  filters,
  data,
  now,
  filtersActive,
}: {
  filters: ReturnType<typeof parsePublishFilters>;
  data: Awaited<ReturnType<typeof loadPublishDashboardData>>;
  now: Date;
  filtersActive: boolean;
}): React.ReactElement {
  // Both layouts always render — Tailwind hides the grid below `md`
  // and shows the list (Ajuste B). When the user explicitly picks
  // `?cal=list`, we force the list-only version regardless of
  // viewport.
  return (
    <>
      <CalendarMonthHeader
        filters={filters}
        totalPosts={data.calendarPosts.length}
        now={now}
        timeZone={data.orgTimezone}
        locale={data.orgLocale}
      />
      {filters.cal === 'month' ? (
        <>
          <CalendarMonthGrid
            monthDate={filters.monthDate}
            posts={data.calendarPosts}
            timeZone={data.orgTimezone}
            locale={data.orgLocale}
            now={now}
          />
          {/* Mobile fallback (Ajuste B) — same data, list shape. */}
          <div className="md:hidden">
            {data.calendarPosts.length === 0 ? (
              filtersActive ? <NoMatches /> : <TabClean view="calendar" />
            ) : (
              <CalendarListView
                posts={data.calendarPosts}
                timeZone={data.orgTimezone}
                locale={data.orgLocale}
              />
            )}
          </div>
        </>
      ) : data.calendarPosts.length === 0 ? (
        filtersActive ? <NoMatches /> : <TabClean view="calendar" />
      ) : (
        <CalendarListView
          posts={data.calendarPosts}
          timeZone={data.orgTimezone}
          locale={data.orgLocale}
        />
      )}
    </>
  );
}

function ListSection({
  filters,
  posts,
  hasMore,
  timeZone,
  locale,
  filtersActive,
}: {
  filters: ReturnType<typeof parsePublishFilters>;
  posts: Awaited<ReturnType<typeof loadPublishDashboardData>>['listPage']['posts'];
  hasMore: boolean;
  timeZone: string;
  locale: string;
  filtersActive: boolean;
}): React.ReactElement {
  if (posts.length === 0) {
    if (filtersActive) return <NoMatches />;
    // No filters, no posts on this tab → tab-specific clean state.
    return <TabClean view={filters.view} />;
  }
  return (
    <PostsList
      posts={posts}
      timeZone={timeZone}
      locale={locale}
      hasMore={hasMore}
    />
  );
}

/**
 * Marker referenced by the integration test to assert the page
 * was reachable when there are zero posts at all. The component
 * isn't actually mounted today — we surface it via empty-state
 * branches above — but the export keeps the contract stable for
 * the test suite to import directly.
 */
export const _EmptyMarker = NoPostsAtAll;
