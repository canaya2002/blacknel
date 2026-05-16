/**
 * /reviews URL filter contract.
 *
 * Mirrors `lib/inbox/filters.ts` (Commit 8) so the URL is the source of
 * truth: refresh, copy-paste and back/forward all preserve state. Same
 * untrusted-input posture — every value runs through an allow-list, a
 * UUID regex, or a date validator, and a single bad value drops the
 * entire filter (not just that entry).
 *
 * Two reviews-specific concerns sit on top of the inbox playbook:
 *
 *   1. **Plan-gated platforms.** Yelp / TripAdvisor / Trustpilot / BBB /
 *      Avvo / X / YouTube / Pinterest / Reddit are Enterprise-only;
 *      LinkedIn / TikTok / WhatsApp need Growth. The UI dropdown shows
 *      every platform with the gated ones dimmed (Commit 13 Ajuste 1),
 *      so the only way to land a gated platform in the URL is a manual
 *      paste or a stale bookmark. We drop those values *silently* from
 *      `filters.platform` and surface them in `gatedPlatforms` so the
 *      page can render the "Yelp requiere Enterprise — filtro ignorado"
 *      banner. The drop is also logged as `reviews.filter.suspicious_input`
 *      with `reason: 'gated_platform'` for observability.
 *
 *   2. **Date range.** `dateFrom` / `dateTo` are validated as
 *      `YYYY-MM-DD`, with `from ≤ to`, `to ≤ today` and a 365-day cap.
 *      Any violation drops *both* bounds together (a half-open range
 *      from a bogus user paste would mislead more than no range at all)
 *      and logs the rejection. The four presets (7d / 30d / 90d /
 *      custom) are encoded on the client into the same `dateFrom` /
 *      `dateTo` URL params — the server doesn't see "preset".
 *
 * Cursor invalidation when the date range changes is a *client*
 * responsibility (Ajuste 3): the filters-bar deletes `cursor` from the
 * URLSearchParams before pushing. The server still accepts a cursor
 * regardless — pagination then degrades to "no rows" if the cursor
 * falls outside the new range, which is acceptable.
 */
import type { PlatformCode } from '../connectors/base';
import { log } from '../log';
import { planAllowsPlatform } from '../plans/gating';
import { type PlanCode } from '../plans/plans';

// ---------------------------------------------------------------------------
// Allow-lists
// ---------------------------------------------------------------------------

export const ALLOWED_REVIEW_STATUS = [
  'pending',
  'in_progress',
  'responded',
  'archived',
  'spam',
] as const;

export const ALLOWED_REVIEW_SENTIMENT = [
  'positive',
  'neutral',
  'negative',
  'unknown',
] as const;

export const ALLOWED_REVIEW_RATING = [1, 2, 3, 4, 5] as const;

/**
 * Every platform Blacknel knows about, in the order the dropdown
 * renders them. `mock` is excluded — it's a test/dev artefact and
 * should never appear in a UI control.
 */
export const ALLOWED_REVIEW_PLATFORM: ReadonlyArray<PlatformCode> = [
  'facebook',
  'instagram',
  'gbp',
  'whatsapp',
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

export type ReviewStatus = (typeof ALLOWED_REVIEW_STATUS)[number];
export type ReviewSentiment = (typeof ALLOWED_REVIEW_SENTIMENT)[number];
export type ReviewRating = (typeof ALLOWED_REVIEW_RATING)[number];
export type AssigneeFilter = string | 'me' | 'unassigned';

export interface ReviewFilters {
  readonly status?: ReadonlyArray<ReviewStatus>;
  readonly rating?: ReadonlyArray<ReviewRating>;
  readonly sentiment?: ReadonlyArray<ReviewSentiment>;
  readonly platform?: ReadonlyArray<PlatformCode>;
  readonly brandId?: string;
  readonly locationId?: string;
  readonly assignedTo?: AssigneeFilter;
  readonly q?: string;
  /** ISO-8601 date (YYYY-MM-DD). Inclusive lower bound on `posted_at`. */
  readonly dateFrom?: string;
  /** ISO-8601 date (YYYY-MM-DD). Inclusive upper bound on `posted_at`. */
  readonly dateTo?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_Q_LEN = 200;
const MAX_RANGE_DAYS = 365;

// ---------------------------------------------------------------------------
// Suspicious-input logging
// ---------------------------------------------------------------------------

interface SuspiciousSample {
  field: string;
  raw: string;
  rejected: string;
  reason: 'malformed' | 'allow_list' | 'gated_platform' | 'malformed_date' | 'invalid_range';
}

function logSuspicious(sample: SuspiciousSample): void {
  log.warn(
    {
      field: sample.field,
      raw: sample.raw.slice(0, 200),
      rejected: sample.rejected.slice(0, 64),
      reason: sample.reason,
    },
    'reviews.filter.suspicious_input',
  );
}

// ---------------------------------------------------------------------------
// Atomic parsers
// ---------------------------------------------------------------------------

function parseAllowList<T extends string>(
  field: string,
  raw: string | null | undefined,
  allowed: ReadonlyArray<T>,
): ReadonlyArray<T> | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const allowedSet = new Set<string>(allowed);
  const out: T[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    if (!allowedSet.has(part)) {
      logSuspicious({ field, raw, rejected: part, reason: 'allow_list' });
      return undefined;
    }
    if (!seen.has(part)) {
      seen.add(part);
      out.push(part as T);
    }
  }
  return out;
}

function parseRating(
  raw: string | null | undefined,
): ReadonlyArray<ReviewRating> | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const out: ReviewRating[] = [];
  const seen = new Set<number>();
  for (const part of parts) {
    const n = Number.parseInt(part, 10);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      logSuspicious({ field: 'rating', raw, rejected: part, reason: 'allow_list' });
      return undefined;
    }
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n as ReviewRating);
    }
  }
  return out;
}

function parseUuid(field: string, raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  if (!UUID_RE.test(raw)) {
    logSuspicious({ field, raw, rejected: raw, reason: 'malformed' });
    return undefined;
  }
  return raw;
}

function parseAssignee(raw: string | null | undefined): AssigneeFilter | undefined {
  if (!raw) return undefined;
  if (raw === 'me' || raw === 'unassigned') return raw;
  if (!UUID_RE.test(raw)) {
    logSuspicious({ field: 'assignedTo', raw, rejected: raw, reason: 'malformed' });
    return undefined;
  }
  return raw;
}

function parseSearch(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  // Cap length — defense in depth on top of the query layer's plainto_tsquery.
  // We slice rather than reject because pasting a long quote shouldn't blank
  // the UI; the user can shorten the query if too greedy.
  return normalized.slice(0, MAX_Q_LEN);
}

interface DatePair {
  from?: string;
  to?: string;
}

/**
 * Parse and cross-validate `dateFrom` / `dateTo`. Returns both fields
 * together so the caller never has to reason about a half-open mismatch
 * — any single failure drops both bounds. `today` is parameterised so
 * tests can pin the clock.
 */
function parseDateRange(
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
  today: Date,
): DatePair {
  if (!rawFrom && !rawTo) return {};

  const todayIso = isoDate(today);

  if (rawFrom && !DATE_RE.test(rawFrom)) {
    logSuspicious({
      field: 'dateFrom',
      raw: rawFrom,
      rejected: rawFrom,
      reason: 'malformed_date',
    });
    return {};
  }
  if (rawTo && !DATE_RE.test(rawTo)) {
    logSuspicious({
      field: 'dateTo',
      raw: rawTo,
      rejected: rawTo,
      reason: 'malformed_date',
    });
    return {};
  }

  // Each bound parses to an actual calendar date (catches 2026-13-40).
  if (rawFrom) {
    const t = Date.parse(`${rawFrom}T00:00:00Z`);
    if (Number.isNaN(t)) {
      logSuspicious({
        field: 'dateFrom',
        raw: rawFrom,
        rejected: rawFrom,
        reason: 'malformed_date',
      });
      return {};
    }
  }
  if (rawTo) {
    const t = Date.parse(`${rawTo}T00:00:00Z`);
    if (Number.isNaN(t)) {
      logSuspicious({
        field: 'dateTo',
        raw: rawTo,
        rejected: rawTo,
        reason: 'malformed_date',
      });
      return {};
    }
  }

  const from = rawFrom ?? undefined;
  const to = rawTo ?? undefined;

  // Constraints (Ajuste 3): from ≤ to, to ≤ today, range ≤ 365 days.
  if (from && to && from > to) {
    logSuspicious({
      field: 'dateRange',
      raw: `${from}..${to}`,
      rejected: 'from>to',
      reason: 'invalid_range',
    });
    return {};
  }
  if (to && to > todayIso) {
    logSuspicious({
      field: 'dateTo',
      raw: to,
      rejected: to,
      reason: 'invalid_range',
    });
    return {};
  }
  if (from && to) {
    const days =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000);
    if (days > MAX_RANGE_DAYS) {
      logSuspicious({
        field: 'dateRange',
        raw: `${from}..${to}`,
        rejected: String(days),
        reason: 'invalid_range',
      });
      return {};
    }
  }

  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Plan-gated platform handling
// ---------------------------------------------------------------------------

interface PlatformPartition {
  /** Survives gating. Goes into the SQL WHERE. */
  allowed: ReadonlyArray<PlatformCode>;
  /** Stripped for plan reasons. Drives the explanatory banner. */
  gated: ReadonlyArray<PlatformCode>;
}

function partitionPlatformsByPlan(
  raw: string,
  values: ReadonlyArray<PlatformCode>,
  plan: PlanCode,
): PlatformPartition {
  const allowed: PlatformCode[] = [];
  const gated: PlatformCode[] = [];
  for (const p of values) {
    if (planAllowsPlatform(plan, p)) {
      allowed.push(p);
    } else {
      gated.push(p);
      logSuspicious({
        field: 'platform',
        raw,
        rejected: p,
        reason: 'gated_platform',
      });
    }
  }
  return { allowed, gated };
}

// ---------------------------------------------------------------------------
// Public parse / encode
// ---------------------------------------------------------------------------

export interface ParsedReviewsRequest {
  readonly filters: ReviewFilters;
  readonly cursor?: string;
  /**
   * Platforms the user asked for that their plan does NOT include. They
   * are dropped from `filters.platform` but exposed here so /reviews can
   * render a "Yelp requiere Enterprise — filtro ignorado" banner.
   */
  readonly gatedPlatforms: ReadonlyArray<PlatformCode>;
}

export interface ParseOpts {
  readonly plan: PlanCode;
  /**
   * Today's date, used to cap `dateTo`. Tests override; production
   * defaults to `new Date()` so the cap moves with the wall clock.
   */
  readonly today?: Date;
}

export function parseReviewFilters(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  opts: ParseOpts,
): ParsedReviewsRequest {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) {
      return searchParams.get(key);
    }
    const v = searchParams[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0) return v[0] ?? null;
    return null;
  };

  const status = parseAllowList('status', get('status'), ALLOWED_REVIEW_STATUS);
  const sentiment = parseAllowList(
    'sentiment',
    get('sentiment'),
    ALLOWED_REVIEW_SENTIMENT,
  );
  const rating = parseRating(get('rating'));
  const rawPlatform = get('platform');
  const platformList = parseAllowList<PlatformCode>(
    'platform',
    rawPlatform,
    ALLOWED_REVIEW_PLATFORM,
  );
  const brandId = parseUuid('brandId', get('brandId'));
  const locationId = parseUuid('locationId', get('locationId'));
  const assignedTo = parseAssignee(get('assignedTo'));
  const q = parseSearch(get('q'));
  const today = opts.today ?? new Date();
  const dates = parseDateRange(get('dateFrom'), get('dateTo'), today);

  const platformPartition = platformList
    ? partitionPlatformsByPlan(rawPlatform ?? '', platformList, opts.plan)
    : { allowed: [] as PlatformCode[], gated: [] as PlatformCode[] };

  const platform =
    platformList && platformPartition.allowed.length > 0
      ? platformPartition.allowed
      : undefined;

  const filters: ReviewFilters = {
    ...maybe('status', status),
    ...maybe('rating', rating),
    ...maybe('sentiment', sentiment),
    ...maybe('platform', platform),
    ...maybe('brandId', brandId),
    ...maybe('locationId', locationId),
    ...maybe('assignedTo', assignedTo),
    ...maybe('q', q),
    ...maybe('dateFrom', dates.from),
    ...maybe('dateTo', dates.to),
  };

  return {
    filters,
    ...maybe('cursor', get('cursor') ?? undefined),
    gatedPlatforms: platformPartition.gated,
  };
}

function maybe<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * `true` iff any filter is set. Drives the "no matches" vs "no reviews"
 * branch in empty-state selection.
 */
export function hasActiveFilters(f: ReviewFilters): boolean {
  return Boolean(
    f.status?.length ||
      f.rating?.length ||
      f.sentiment?.length ||
      f.platform?.length ||
      f.brandId ||
      f.locationId ||
      f.assignedTo ||
      f.q ||
      f.dateFrom ||
      f.dateTo,
  );
}

/**
 * `true` iff the active filters narrow the result set to a less-common
 * slice (archived / spam, or rating=1 alone). The empty-state for a
 * narrow slice nudges "ver todas" instead of "limpiar filtros" because
 * the user explicitly asked for the slice and probably wants to widen
 * it, not nuke their location/brand scoping.
 */
export function isNarrowSlice(f: ReviewFilters): boolean {
  // Archived / spam only — same heuristic as inbox.
  if (f.status?.length) {
    const onlyTerminal = f.status.every((s) => s === 'archived' || s === 'spam');
    if (onlyTerminal) return true;
  }
  // Rating=[1] is the "show me only 1-star" cut and tends to be empty.
  if (f.rating?.length === 1 && f.rating[0] === 1) return true;
  return false;
}

/** Human-friendly label for the narrow-slice empty state heading. */
export function narrowSliceLabel(f: ReviewFilters): string {
  if (f.status?.length === 1) {
    return f.status[0] === 'archived' ? 'archivadas' : 'marcadas como spam';
  }
  if (f.status?.length && f.status.every((s) => s === 'archived' || s === 'spam')) {
    return 'archivadas o spam';
  }
  if (f.rating?.length === 1 && f.rating[0] === 1) return 'de 1 estrella';
  return 'en este corte';
}

// ---------------------------------------------------------------------------
// Encode: filter object → URLSearchParams
// ---------------------------------------------------------------------------

export function encodeReviewFilters(
  filters: ReviewFilters,
  options?: { cursor?: string },
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status?.length) params.set('status', filters.status.join(','));
  if (filters.rating?.length) params.set('rating', filters.rating.join(','));
  if (filters.sentiment?.length) params.set('sentiment', filters.sentiment.join(','));
  if (filters.platform?.length) params.set('platform', filters.platform.join(','));
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.locationId) params.set('locationId', filters.locationId);
  if (filters.assignedTo) params.set('assignedTo', filters.assignedTo);
  if (filters.q) params.set('q', filters.q);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (options?.cursor) params.set('cursor', options.cursor);
  return params;
}
