/**
 * Inbox URL filter contract.
 *
 * The /inbox page mirrors its state into the URL so refresh, copy-paste
 * and back/forward all work. The URL is therefore untrusted input — a
 * phishing link could craft `?status=open,evil_injection` and we MUST
 * not 500 or silently include the bad value.
 *
 * Defense-in-depth here is layered:
 *
 *   1. Per-filter allow-list. If ANY value in the comma-separated list
 *      falls outside the allow-list, the whole filter is dropped (not
 *      just the bad value) and the event is logged as
 *      `inbox.filter.suspicious_input`. Treat the URL as compromised
 *      and reset to "no filter" for that key — far safer than partial
 *      acceptance.
 *
 *   2. Trim + lowercase + length cap on the search `q`. Drizzle / the
 *      query layer uses `plainto_tsquery` which sanitises operators,
 *      but capping length stops a 100KB URL from reaching the planner.
 *
 *   3. UUID validation on `brandId` / `locationId` / `assignedTo`.
 *      Anything not matching `UUID_RE` resets the field.
 *
 * Output of `parseInboxFilters` is the canonical, validated shape every
 * consumer reads. Conversely, `encodeInboxFilters` converts a filter
 * object back into URLSearchParams for `router.replace()`.
 */
import type { PlatformCode } from '../connectors/base';
import { log } from '../log';

// ---------------------------------------------------------------------------
// Allow-lists
// ---------------------------------------------------------------------------

export const ALLOWED_STATUS = ['open', 'pending', 'closed', 'snoozed', 'spam'] as const;
export const ALLOWED_PRIORITY = ['low', 'normal', 'high', 'urgent'] as const;
export const ALLOWED_KIND = ['dm', 'comment', 'mention', 'review', 'whatsapp'] as const;
export const ALLOWED_SENTIMENT = ['positive', 'neutral', 'negative', 'unknown'] as const;
export const ALLOWED_PLATFORM: ReadonlyArray<PlatformCode> = [
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

export type ThreadStatus = (typeof ALLOWED_STATUS)[number];
export type ThreadPriority = (typeof ALLOWED_PRIORITY)[number];
export type ThreadKind = (typeof ALLOWED_KIND)[number];
export type ThreadSentiment = (typeof ALLOWED_SENTIMENT)[number];

export type AssigneeFilter = string | 'me' | 'unassigned';

export interface InboxFilters {
  readonly status?: ReadonlyArray<ThreadStatus>;
  readonly priority?: ReadonlyArray<ThreadPriority>;
  readonly kind?: ReadonlyArray<ThreadKind>;
  readonly sentiment?: ReadonlyArray<ThreadSentiment>;
  readonly platform?: ReadonlyArray<PlatformCode>;
  readonly brandId?: string;
  readonly locationId?: string;
  readonly assignedTo?: AssigneeFilter;
  readonly tags?: ReadonlyArray<string>;
  readonly q?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TAG_RE = /^[a-z0-9_-]+$/i;

const MAX_Q_LEN = 200;
const MAX_TAGS = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FieldSamples {
  field: string;
  raw: string;
  rejected: string;
}

function logSuspicious(samples: FieldSamples): void {
  log.warn(
    {
      field: samples.field,
      raw: samples.raw.slice(0, 200),
      rejected: samples.rejected.slice(0, 64),
    },
    'inbox.filter.suspicious_input',
  );
}

/**
 * Parse a comma-separated multi-value filter against an allow-list.
 * Returns `undefined` when the input is missing OR contains ANY value
 * outside the allow-list — the all-or-nothing semantic is intentional
 * (a partial filter would hide what the user thinks they're seeing).
 */
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
      logSuspicious({ field, raw, rejected: part });
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
    logSuspicious({ field, raw, rejected: raw });
    return undefined;
  }
  return raw;
}

function parseAssignee(raw: string | null | undefined): AssigneeFilter | undefined {
  if (!raw) return undefined;
  if (raw === 'me' || raw === 'unassigned') return raw;
  if (!UUID_RE.test(raw)) {
    logSuspicious({ field: 'assignedTo', raw, rejected: raw });
    return undefined;
  }
  return raw;
}

function parseTags(raw: string | null | undefined): ReadonlyArray<string> | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  if (parts.length === 0) return undefined;
  const cleaned: string[] = [];
  for (const part of parts) {
    if (!TAG_RE.test(part) || part.length > 50) {
      logSuspicious({ field: 'tags', raw, rejected: part });
      return undefined;
    }
    if (!cleaned.includes(part)) cleaned.push(part);
  }
  return cleaned;
}

function parseSearch(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  // Cap at MAX_Q_LEN — defense in depth on top of plainto_tsquery.
  // We don't reject overlong inputs (a user pasting an essay shouldn't
  // get an empty UI), we slice them. Operators in the query are still
  // sanitised by Postgres when wrapped in plainto_tsquery.
  return normalized.slice(0, MAX_Q_LEN);
}

// ---------------------------------------------------------------------------
// Parse: URL → filter object
// ---------------------------------------------------------------------------

export interface ParsedInboxRequest {
  readonly filters: InboxFilters;
  readonly cursor?: string;
}

/**
 * Build a validated `InboxFilters` object from a URL search-params-like
 * map (works with `URLSearchParams` directly, Next's `searchParams`
 * object, or a plain Record).
 */
export function parseInboxFilters(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): ParsedInboxRequest {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) {
      return searchParams.get(key);
    }
    const v = searchParams[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0) return v[0] ?? null;
    return null;
  };

  const filters: InboxFilters = {
    ...maybe('status', parseAllowList('status', get('status'), ALLOWED_STATUS)),
    ...maybe('priority', parseAllowList('priority', get('priority'), ALLOWED_PRIORITY)),
    ...maybe('kind', parseAllowList('kind', get('kind'), ALLOWED_KIND)),
    ...maybe('sentiment', parseAllowList('sentiment', get('sentiment'), ALLOWED_SENTIMENT)),
    ...maybe('platform', parseAllowList('platform', get('platform'), ALLOWED_PLATFORM)),
    ...maybe('brandId', parseUuid('brandId', get('brandId'))),
    ...maybe('locationId', parseUuid('locationId', get('locationId'))),
    ...maybe('assignedTo', parseAssignee(get('assignedTo'))),
    ...maybe('tags', parseTags(get('tags'))),
    ...maybe('q', parseSearch(get('q'))),
  };

  return {
    filters,
    ...maybe('cursor', get('cursor') ?? undefined),
  };
}

function maybe<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * `true` iff any filter is set. Drives the "is the user actively
 * filtering" branch in empty-state selection.
 */
export function hasActiveFilters(f: InboxFilters): boolean {
  return Boolean(
    f.status?.length ||
      f.priority?.length ||
      f.kind?.length ||
      f.sentiment?.length ||
      f.platform?.length ||
      f.brandId ||
      f.locationId ||
      f.assignedTo ||
      f.tags?.length ||
      f.q,
  );
}

// ---------------------------------------------------------------------------
// Encode: filter object → URLSearchParams
// ---------------------------------------------------------------------------

export function encodeInboxFilters(
  filters: InboxFilters,
  options?: { cursor?: string },
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status?.length) params.set('status', filters.status.join(','));
  if (filters.priority?.length) params.set('priority', filters.priority.join(','));
  if (filters.kind?.length) params.set('kind', filters.kind.join(','));
  if (filters.sentiment?.length) params.set('sentiment', filters.sentiment.join(','));
  if (filters.platform?.length) params.set('platform', filters.platform.join(','));
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.locationId) params.set('locationId', filters.locationId);
  if (filters.assignedTo) params.set('assignedTo', filters.assignedTo);
  if (filters.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters.q) params.set('q', filters.q);
  if (options?.cursor) params.set('cursor', options.cursor);
  return params;
}
