/**
 * /reputation URL filter contract.
 *
 * Smaller surface than /reviews filters (Commit 13) — reputation is
 * read-only aggregations, not row-level slicing — but mirrors the
 * same defensive posture: every value runs through an allow-list or
 * a UUID regex, any single bad value drops the whole filter, and the
 * date range is validated pairwise.
 *
 * Filters supported:
 *
 *   - brandId      (UUID)
 *   - locationId   (UUID)
 *   - platform     (PlatformCode allow-list)
 *   - dateRange    (preset 30 / 90 / 365 days, OR custom dateFrom +
 *                   dateTo). The dashboard's default when none is
 *                   provided is 30 days — different from /reviews
 *                   which defaults to "no range".
 *
 * The KPI deltas (Ajuste 3) need the size of the active window so
 * they can compute the matching "previous window" — `windowDays`
 * exposes that derived value to the loader without making each KPI
 * recompute it.
 */
import type { PlatformCode } from '../connectors/base';
import { log } from '../log';

export const ALLOWED_REPUTATION_PLATFORM: ReadonlyArray<PlatformCode> = [
  'facebook',
  'instagram',
  'gbp',
  'tiktok',
  'linkedin',
  'x',
  'youtube',
  'pinterest',
  'reddit',
  'yelp',
  'tripadvisor',
  'trustpilot',
  'bbb',
  'avvo',
];

export const ALLOWED_PRESET = [30, 90, 365] as const;
export type PresetDays = (typeof ALLOWED_PRESET)[number];

export interface ReputationFilters {
  readonly brandId?: string;
  readonly locationId?: string;
  readonly platform?: PlatformCode;
  readonly dateFrom: Date;
  readonly dateTo: Date;
  /**
   * Length of the active window in days, used by the delta math to
   * compute the matching "previous window". `Math.round` keeps it
   * integer even when the user pastes timestamps with hours.
   */
  readonly windowDays: number;
  /** Echoes which preset was selected, when one was. Drives UI tab state. */
  readonly preset: PresetDays | 'custom';
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

interface ParseOpts {
  /** Today's UTC midnight. Injected by tests; production passes `new Date()`. */
  now: Date;
}

function logSuspicious(field: string, raw: string, reason: string): void {
  log.warn(
    { field, raw: raw.slice(0, 200), reason },
    'reputation.filter.suspicious_input',
  );
}

function parseUuid(field: string, raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (!UUID_RE.test(raw)) {
    logSuspicious(field, raw, 'malformed');
    return undefined;
  }
  return raw;
}

function parsePlatform(raw: string | null | undefined): PlatformCode | undefined {
  if (!raw) return undefined;
  if (!ALLOWED_REPUTATION_PLATFORM.includes(raw as PlatformCode)) {
    logSuspicious('platform', raw, 'allow_list');
    return undefined;
  }
  return raw as PlatformCode;
}

function parsePreset(raw: string | null | undefined): PresetDays | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || !ALLOWED_PRESET.includes(n as PresetDays)) {
    logSuspicious('preset', raw, 'allow_list');
    return undefined;
  }
  return n as PresetDays;
}

interface RawDateRange {
  from?: Date;
  to?: Date;
}

function parseCustomRange(
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
  now: Date,
): RawDateRange {
  if (!rawFrom || !rawTo) return {};

  if (!DATE_RE.test(rawFrom) || !DATE_RE.test(rawTo)) {
    logSuspicious('dateRange', `${rawFrom}..${rawTo}`, 'malformed_date');
    return {};
  }
  const from = Date.parse(`${rawFrom}T00:00:00Z`);
  const to = Date.parse(`${rawTo}T23:59:59Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    logSuspicious('dateRange', `${rawFrom}..${rawTo}`, 'malformed_date');
    return {};
  }
  if (from > to) {
    logSuspicious('dateRange', `${rawFrom}..${rawTo}`, 'invalid_range');
    return {};
  }
  if (to > now.getTime()) {
    logSuspicious('dateRange', `${rawFrom}..${rawTo}`, 'future_to');
    return {};
  }
  if ((to - from) / DAY_MS > MAX_RANGE_DAYS) {
    logSuspicious('dateRange', `${rawFrom}..${rawTo}`, 'too_wide');
    return {};
  }
  return { from: new Date(from), to: new Date(to) };
}

/**
 * Parse URL search params into a normalized filter object. The
 * function ALWAYS returns a dateFrom/dateTo pair — when the user
 * provides nothing valid, we default to the last 30 days.
 *
 * Precedence: custom range (`dateFrom` + `dateTo`) beats preset.
 * If only one custom bound is provided, the preset wins instead.
 */
export function parseReputationFilters(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  opts: ParseOpts,
): ReputationFilters {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) return searchParams.get(key);
    const v = searchParams[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0) return v[0] ?? null;
    return null;
  };

  const brandId = parseUuid('brandId', get('brandId'));
  const locationId = parseUuid('locationId', get('locationId'));
  const platform = parsePlatform(get('platform'));
  const presetDays = parsePreset(get('preset'));
  const custom = parseCustomRange(get('dateFrom'), get('dateTo'), opts.now);

  let dateFrom: Date;
  let dateTo: Date;
  let preset: PresetDays | 'custom';
  if (custom.from && custom.to) {
    dateFrom = custom.from;
    dateTo = custom.to;
    preset = 'custom';
  } else {
    const days = presetDays ?? 30;
    dateTo = opts.now;
    dateFrom = new Date(opts.now.getTime() - days * DAY_MS);
    preset = days;
  }

  const windowDays = Math.max(
    1,
    Math.round((dateTo.getTime() - dateFrom.getTime()) / DAY_MS),
  );

  return {
    ...(brandId ? { brandId } : {}),
    ...(locationId ? { locationId } : {}),
    ...(platform ? { platform } : {}),
    dateFrom,
    dateTo,
    windowDays,
    preset,
  };
}

/**
 * Encode filters back into URLSearchParams. The dashboard's filters
 * bar uses this when the user changes a control; deletes any param
 * that isn't set so the URL stays minimal.
 */
export function encodeReputationFilters(filters: ReputationFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.locationId) params.set('locationId', filters.locationId);
  if (filters.platform) params.set('platform', filters.platform);
  if (filters.preset === 'custom') {
    params.set('dateFrom', toIsoDate(filters.dateFrom));
    params.set('dateTo', toIsoDate(filters.dateTo));
  } else {
    params.set('preset', String(filters.preset));
  }
  return params;
}

/** Returns the previous-window bounds the delta math needs. */
export function previousWindow(filters: ReputationFilters): {
  prevFrom: Date;
  prevTo: Date;
} {
  const windowMs = filters.dateTo.getTime() - filters.dateFrom.getTime();
  return {
    prevFrom: new Date(filters.dateFrom.getTime() - windowMs),
    prevTo: filters.dateFrom,
  };
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
