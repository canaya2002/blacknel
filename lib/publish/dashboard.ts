import 'server-only';

import { type AnyPgTx, dbAs } from '../db/client';

import { endOfMonthUtc, type PublishFilters, statusForTab } from './filters';
import {
  getCalendarMonthWithTx,
  getPostKpiCountsWithTx,
  listPostsWithTx,
  type CalendarPost,
  type PostKpiCounts,
  type PostListItem,
  type PostListPage,
} from './queries';

/**
 * Single-pass loader for the /publish page (Ajuste 3).
 *
 * Mirrors `loadReputationDashboardData` (Commit 15): one `dbAs`
 * transaction; per-card queries run in parallel under
 * `Promise.all`; a DI bag lets tests spy on per-query invocations
 * and assert each was called exactly once.
 *
 * Calendar-month data is conditional. When `filters.view !==
 * 'calendar'` we skip the calendar query — the named tabs render
 * the list view only and the calendar grid is hidden. The DI bag
 * still exposes the spy for the test that verifies the conditional
 * behavior.
 */

export interface PublishDashboardData {
  readonly filters: PublishFilters;
  readonly kpis: PostKpiCounts;
  readonly listPage: PostListPage;
  /**
   * Posts that fall inside the current calendar month. Empty when
   * the user is viewing a non-calendar tab.
   */
  readonly calendarPosts: ReadonlyArray<CalendarPost>;
}

export interface PublishDashboardDeps {
  list: typeof listPostsWithTx;
  kpis: typeof getPostKpiCountsWithTx;
  calendar: typeof getCalendarMonthWithTx;
}

export const defaultPublishDashboardDeps: PublishDashboardDeps = {
  list: listPostsWithTx,
  kpis: getPostKpiCountsWithTx,
  calendar: getCalendarMonthWithTx,
};

export interface LoadDashboardOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: PublishFilters;
  readonly pageSize?: number;
  /** DI override for the spy contract test. */
  readonly deps?: PublishDashboardDeps;
}

export async function loadPublishDashboardData(
  opts: LoadDashboardOpts,
): Promise<PublishDashboardData> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    (tx) => loadPublishDashboardDataWithTx(tx, opts),
  );
}

/**
 * Test variant accepting an existing transaction. Production
 * `loadPublishDashboardData` opens its own `dbAs`; this one runs
 * inside the caller's so integration tests can drive a fixture
 * pglite via `runAs`.
 */
export async function loadPublishDashboardDataWithTx(
  tx: AnyPgTx,
  opts: LoadDashboardOpts,
): Promise<PublishDashboardData> {
  const deps = opts.deps ?? defaultPublishDashboardDeps;
  const filters = opts.filters;

  const listFilters = {
    ...(filters.brandId ? { brandId: filters.brandId } : {}),
    ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.scheduledFrom ? { scheduledFrom: filters.scheduledFrom } : {}),
    ...(filters.scheduledTo ? { scheduledTo: filters.scheduledTo } : {}),
  };
  // The tab projects the status set for non-calendar views; for
  // calendar we honor the user's explicit status filter (if any).
  const tabStatus = statusForTab(filters.view, filters.status);

  const includeCalendar = filters.view === 'calendar';

  // The calendar slot is `Promise.resolve([])` when the tab isn't
  // calendar — the test asserts `deps.calendar` was called either
  // once (calendar tab) or zero times (any other tab).
  const [listPage, kpis, calendarPosts] = await Promise.all([
    deps.list(tx, {
      orgId: opts.orgId,
      userId: opts.userId,
      filters: {
        ...listFilters,
        ...(tabStatus ? { status: tabStatus } : {}),
      },
      ...(opts.pageSize ? { pageSize: opts.pageSize } : {}),
    }),
    deps.kpis(tx, opts.orgId),
    includeCalendar
      ? deps.calendar(tx, {
          orgId: opts.orgId,
          monthFrom: filters.monthDate,
          monthTo: endOfMonthUtc(filters.monthDate),
          ...(filters.brandId ? { brandId: filters.brandId } : {}),
          ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
          ...(filters.status?.length ? { status: filters.status } : {}),
        })
      : Promise.resolve<ReadonlyArray<CalendarPost>>([]),
  ]);

  return {
    filters,
    kpis,
    listPage,
    calendarPosts,
  };
}

/**
 * Shape-narrowed re-export so consumers don't have to thread the
 * query module separately for typing. Drops the cursor field
 * since list rendering on /publish doesn't use cursor pagination
 * yet (Commit 21 polish).
 */
export type PublishDashboardListItem = PostListItem;
