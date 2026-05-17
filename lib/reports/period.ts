import { log } from '../log';

/**
 * Period selector for /reports (Phase 8 / Commit 27).
 *
 * Three presets (7d / 30d / 90d) cover 90%+ of dashboards. Custom
 * ranges land in a later commit when the date-picker UI is in
 * scope.
 *
 * The previous-period math (used by `Ajuste 1` KPI deltas) mirrors
 * the current window's length, immediately preceding it. Examples:
 *
 *   7d   current: [now-7d, now]   previous: [now-14d, now-7d]
 *   30d  current: [now-30d, now]  previous: [now-60d, now-30d]
 *   90d  current: [now-90d, now]  previous: [now-180d, now-90d]
 *
 * All anchors compute from a single `now` instance the page
 * captures at request time. Calling sites must pass it through;
 * never call `Date.now()` inside render code (React 19 purity).
 */

export type ReportPeriod = '7d' | '30d' | '90d';

const ALLOWED_PERIODS: ReadonlyArray<ReportPeriod> = ['7d', '30d', '90d'];

export interface ReportRange {
  readonly currentStart: Date;
  readonly currentEnd: Date;
  readonly previousStart: Date;
  readonly previousEnd: Date;
  readonly period: ReportPeriod;
  /** Window length in ms; convenient for the comparison ratios. */
  readonly windowMs: number;
}

const PERIOD_DAYS: Readonly<Record<ReportPeriod, number>> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function logSuspicious(field: string, raw: string, reason: string): void {
  log.warn(
    { field, raw: raw.slice(0, 100), reason },
    'reports.filter.suspicious_input',
  );
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `scheduled` added in Phase 9 / Commit 34 (D-34-6 a) for the
// scheduled-reports tab. Charter touch on Phase 8 surface
// justified: scheduled_report_emails is a Growth-only feature and
// /reports is the natural home for the tab.
const ALLOWED_SECTIONS = [
  'overview',
  'inbox',
  'publishing',
  'ai',
  'ads',
  'scheduled',
] as const;
export type ReportSection = (typeof ALLOWED_SECTIONS)[number];

export interface ReportFilters {
  readonly section: ReportSection;
  readonly period: ReportPeriod;
  readonly brandId: string | null;
  readonly fresh: boolean;
}

function pickFirst(raw: string | ReadonlyArray<string> | undefined): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

/**
 * Parses `searchParams` into a clean `ReportFilters` shape.
 * Defaults: `section='overview'`, `period='30d'` (D-27-2),
 * `brandId=null` (org-wide), `fresh=false`.
 */
export function parseReportFilters(
  searchParams: Record<string, string | string[] | undefined>,
): ReportFilters {
  let section: ReportSection = 'overview';
  const rawSection = pickFirst(searchParams.section);
  if (rawSection !== undefined) {
    if ((ALLOWED_SECTIONS as ReadonlyArray<string>).includes(rawSection)) {
      section = rawSection as ReportSection;
    } else {
      logSuspicious('section', rawSection, 'not_in_allow_list');
    }
  }

  let period: ReportPeriod = '30d';
  const rawPeriod = pickFirst(searchParams.period);
  if (rawPeriod !== undefined) {
    if ((ALLOWED_PERIODS as ReadonlyArray<string>).includes(rawPeriod)) {
      period = rawPeriod as ReportPeriod;
    } else {
      logSuspicious('period', rawPeriod, 'not_in_allow_list');
    }
  }

  let brandId: string | null = null;
  const rawBrand = pickFirst(searchParams.brandId);
  if (rawBrand !== undefined) {
    if (UUID_RE.test(rawBrand)) {
      brandId = rawBrand;
    } else {
      logSuspicious('brandId', rawBrand, 'not_a_uuid');
    }
  }

  const fresh = pickFirst(searchParams.fresh) === '1';

  return { section, period, brandId, fresh };
}

/**
 * Computes the current + previous time windows for a `period`,
 * anchored at `now`. Pure function — no `Date.now()` call.
 */
export function computeRange(period: ReportPeriod, now: Date): ReportRange {
  const days = PERIOD_DAYS[period];
  const ms = days * 86_400_000;
  const currentEnd = now;
  const currentStart = new Date(currentEnd.getTime() - ms);
  const previousEnd = currentStart;
  const previousStart = new Date(previousEnd.getTime() - ms);
  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    period,
    windowMs: ms,
  };
}

// ---------------------------------------------------------------------------
// Delta math (shared with kpi-card.tsx)
// ---------------------------------------------------------------------------

const FLAT_THRESHOLD = 0.05;

export type DeltaTrend = 'up' | 'down' | 'flat';

export interface DeltaShape {
  readonly current: number | null;
  readonly previous: number | null;
  readonly delta: number | null;
  readonly trend: DeltaTrend;
}

/**
 * Computes a `DeltaShape` for two scalar metrics. Returns
 * `trend='flat'` when the relative change is < 5% (Ajuste 1
 * threshold).
 *
 *   current=null OR previous=null   → trend='flat', delta=null
 *   previous=0  AND current=0       → trend='flat'
 *   previous=0  AND current>0       → trend='up' (delta=current)
 *   |relativeChange| < FLAT         → trend='flat'
 */
export function makeDelta(current: number | null, previous: number | null): DeltaShape {
  if (current === null || previous === null) {
    return { current, previous, delta: null, trend: 'flat' };
  }
  const raw = current - previous;
  if (previous === 0) {
    if (current === 0) {
      return { current, previous, delta: 0, trend: 'flat' };
    }
    return { current, previous, delta: raw, trend: current > 0 ? 'up' : 'down' };
  }
  const rel = Math.abs(raw / previous);
  if (rel < FLAT_THRESHOLD) {
    return { current, previous, delta: raw, trend: 'flat' };
  }
  return {
    current,
    previous,
    delta: raw,
    trend: raw > 0 ? 'up' : 'down',
  };
}

export const _FLAT_THRESHOLD_FOR_TESTS = FLAT_THRESHOLD;
