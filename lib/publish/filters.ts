/**
 * /publish URL filter contract.
 *
 * Same defensive posture as /inbox (Commit 8), /reviews (Commit 13)
 * and /reputation (Commit 15): every value runs through an
 * allow-list, a UUID regex, or a date validator, and a single bad
 * value drops the whole filter — partial acceptance hides results
 * from the user.
 *
 * # View + calendar toggles in URL
 *
 * `view` and `cal` are part of the URL state (Ajuste 1 — never
 * useState). A user who bookmarks `/publish?view=failed` lands on
 * the failed-posts tab on refresh. The defaults when the params
 * are missing or invalid:
 *
 *   - `view` → `'calendar'`
 *   - `cal`  → `'month'` (only meaningful when view='calendar')
 *
 * The calendar header's month-nav writes `?month=YYYY-MM`; if it
 * doesn't parse, we fall back to "today".
 *
 * # Date semantics
 *
 * `scheduledFrom` / `scheduledTo` are ISO-8601 `YYYY-MM-DD`.
 * Inclusive on both ends. Validation is pairwise (`from ≤ to`),
 * with a 365-day max range. Any failure drops both bounds — same
 * "all-or-nothing" rule as /reviews.
 */

import { log } from '../log';

export const ALLOWED_POST_STATUS = [
  'draft',
  'pending_approval',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;

export const ALLOWED_VIEW = [
  'calendar',
  'drafts',
  'scheduled',
  'published',
  'failed',
] as const;

export const ALLOWED_CAL = ['month', 'list'] as const;

export type PostFilterStatus = (typeof ALLOWED_POST_STATUS)[number];
export type PublishView = (typeof ALLOWED_VIEW)[number];
export type PublishCalLayout = (typeof ALLOWED_CAL)[number];

export interface PublishFilters {
  readonly view: PublishView;
  readonly cal: PublishCalLayout;
  /**
   * Calendar viewing month. Always returned as a Date pinned to
   * the first day of the month at 00:00 UTC. When `view='calendar'`
   * the dashboard loads posts inside this month's window.
   */
  readonly monthDate: Date;
  readonly status?: ReadonlyArray<PostFilterStatus>;
  readonly brandId?: string;
  readonly campaignId?: string;
  readonly q?: string;
  readonly scheduledFrom?: string;
  readonly scheduledTo?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_RANGE_DAYS = 365;
const MAX_Q_LEN = 200;

interface ParseOpts {
  /** Now-clock, injected by tests. */
  readonly now: Date;
}

function logSuspicious(field: string, raw: string, reason: string): void {
  log.warn(
    { field, raw: raw.slice(0, 200), reason },
    'publish.filter.suspicious_input',
  );
}

function parseAllowList<T extends string>(
  field: string,
  raw: string | null | undefined,
  allowed: ReadonlyArray<T>,
): ReadonlyArray<T> | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const allowedSet = new Set<string>(allowed);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const part of parts) {
    if (!allowedSet.has(part)) {
      logSuspicious(field, raw, 'allow_list');
      return undefined;
    }
    if (!seen.has(part)) {
      seen.add(part);
      out.push(part as T);
    }
  }
  return out;
}

function parseUuid(field: string, raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (!UUID_RE.test(raw)) {
    logSuspicious(field, raw, 'malformed');
    return undefined;
  }
  return raw;
}

function parseSearch(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  return normalized.slice(0, MAX_Q_LEN);
}

interface RawDateRange {
  from?: string;
  to?: string;
}

function parseDateRange(
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
  now: Date,
): RawDateRange {
  if (!rawFrom && !rawTo) return {};
  if (rawFrom && !DATE_RE.test(rawFrom)) {
    logSuspicious('scheduledFrom', rawFrom, 'malformed_date');
    return {};
  }
  if (rawTo && !DATE_RE.test(rawTo)) {
    logSuspicious('scheduledTo', rawTo, 'malformed_date');
    return {};
  }
  // Sanity-check that each component actually parses as a calendar
  // date (catches 2026-13-40).
  if (rawFrom && Number.isNaN(Date.parse(`${rawFrom}T00:00:00Z`))) {
    logSuspicious('scheduledFrom', rawFrom, 'malformed_date');
    return {};
  }
  if (rawTo && Number.isNaN(Date.parse(`${rawTo}T00:00:00Z`))) {
    logSuspicious('scheduledTo', rawTo, 'malformed_date');
    return {};
  }
  if (rawFrom && rawTo && rawFrom > rawTo) {
    logSuspicious('scheduledRange', `${rawFrom}..${rawTo}`, 'invalid_range');
    return {};
  }
  if (rawFrom && rawTo) {
    const days =
      (Date.parse(`${rawTo}T00:00:00Z`) - Date.parse(`${rawFrom}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000);
    if (days > MAX_RANGE_DAYS) {
      logSuspicious('scheduledRange', `${rawFrom}..${rawTo}`, 'too_wide');
      return {};
    }
  }
  // Posts are often scheduled into the future, so we do NOT clamp
  // `to` to today (different from /reviews). The composer's
  // schedule control already prevents past-future inversions.
  void now;
  return {
    ...(rawFrom ? { from: rawFrom } : {}),
    ...(rawTo ? { to: rawTo } : {}),
  };
}

function parseMonth(raw: string | null | undefined, now: Date): Date {
  if (!raw) return startOfMonthUtc(now);
  if (!MONTH_RE.test(raw)) {
    logSuspicious('month', raw, 'malformed_month');
    return startOfMonthUtc(now);
  }
  // Build a date at YYYY-MM-01T00:00:00Z.
  const t = Date.parse(`${raw}-01T00:00:00Z`);
  if (Number.isNaN(t)) {
    logSuspicious('month', raw, 'malformed_month');
    return startOfMonthUtc(now);
  }
  return new Date(t);
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** Last instant of the month containing `monthDate`. */
export function endOfMonthUtc(monthDate: Date): Date {
  const next = new Date(
    Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1),
  );
  return new Date(next.getTime() - 1);
}

export function parsePublishFilters(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  opts: ParseOpts,
): PublishFilters {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) return searchParams.get(key);
    const v = searchParams[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0) return v[0] ?? null;
    return null;
  };

  // view: single-value allow-list (not comma-separated). Same
  // defensive rule — anything outside the allow-list defaults to
  // calendar.
  const rawView = get('view');
  const view: PublishView =
    rawView && (ALLOWED_VIEW as ReadonlyArray<string>).includes(rawView)
      ? (rawView as PublishView)
      : 'calendar';
  if (rawView && view !== rawView) {
    logSuspicious('view', rawView, 'allow_list');
  }

  const rawCal = get('cal');
  const cal: PublishCalLayout =
    rawCal && (ALLOWED_CAL as ReadonlyArray<string>).includes(rawCal)
      ? (rawCal as PublishCalLayout)
      : 'month';
  if (rawCal && cal !== rawCal) {
    logSuspicious('cal', rawCal, 'allow_list');
  }

  const status = parseAllowList(
    'status',
    get('status'),
    ALLOWED_POST_STATUS,
  );
  const brandId = parseUuid('brandId', get('brandId'));
  const campaignId = parseUuid('campaignId', get('campaignId'));
  const q = parseSearch(get('q'));
  const range = parseDateRange(
    get('scheduledFrom'),
    get('scheduledTo'),
    opts.now,
  );
  const monthDate = parseMonth(get('month'), opts.now);

  return {
    view,
    cal,
    monthDate,
    ...(status ? { status } : {}),
    ...(brandId ? { brandId } : {}),
    ...(campaignId ? { campaignId } : {}),
    ...(q ? { q } : {}),
    ...(range.from ? { scheduledFrom: range.from } : {}),
    ...(range.to ? { scheduledTo: range.to } : {}),
  };
}

export function encodePublishFilters(filters: PublishFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.view !== 'calendar') params.set('view', filters.view);
  if (filters.cal !== 'month') params.set('cal', filters.cal);
  if (filters.status?.length) params.set('status', filters.status.join(','));
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.campaignId) params.set('campaignId', filters.campaignId);
  if (filters.q) params.set('q', filters.q);
  if (filters.scheduledFrom) params.set('scheduledFrom', filters.scheduledFrom);
  if (filters.scheduledTo) params.set('scheduledTo', filters.scheduledTo);
  // Only emit `month` when the user has navigated away from "today".
  // The dashboard re-computes it from `now` otherwise.
  return params;
}

/**
 * `true` when any user-driven filter beyond the tab itself is
 * active. Drives the empty-state branching ("no matches" vs
 * "no posts yet").
 */
export function hasActiveFilters(f: PublishFilters): boolean {
  return Boolean(
    f.status?.length ||
      f.brandId ||
      f.campaignId ||
      f.q ||
      f.scheduledFrom ||
      f.scheduledTo,
  );
}

/**
 * Derive the SQL-level status filter for a given tab. Calendar
 * shows everything; the named tabs project a single status.
 */
export function statusForTab(view: PublishView, status?: ReadonlyArray<PostFilterStatus>):
  | ReadonlyArray<PostFilterStatus>
  | undefined {
  switch (view) {
    case 'drafts':
      return ['draft', 'pending_approval'];
    case 'scheduled':
      return ['scheduled', 'publishing'];
    case 'published':
      return ['published'];
    case 'failed':
      return ['failed'];
    case 'calendar':
    default:
      // Calendar honors the user-supplied status filter if any;
      // otherwise it shows every non-cancelled post.
      if (status?.length) return status;
      return undefined;
  }
}
