/**
 * Approvals URL filter contract.
 *
 * Same defense-in-depth as `lib/inbox/filters.ts`:
 *
 *   - Per-filter allow-list. Any out-of-list value drops the entire
 *     filter (not just the bad value) and logs `suspicious_input`.
 *   - UUID validation on `assignedTo` (except for the `me` / `any` /
 *     `unassigned` sentinels).
 *
 * Defaults on first load surface what needs attention:
 *
 *   status   = ['pending', 'escalated']
 *   kind     = (any)
 *   riskLevel= (any)
 *   assignedTo = (any)
 *
 * Defaults apply only when the URL has NO filter set at all. The
 * moment a user toggles a filter from the bar, defaults are dropped
 * — the URL is authoritative.
 */
import { log } from '../log';

export const ALLOWED_STATUS = [
  'pending',
  'approved',
  'rejected',
  'edited_approved',
  'escalated',
  'expired',
] as const;
export const ALLOWED_KIND = [
  'inbox_reply',
  'review_response',
  'post',
  'crisis_response',
  'campaign',
] as const;
export const ALLOWED_RISK_LEVEL = ['low', 'medium', 'high', 'critical'] as const;

export type ApprovalStatus = (typeof ALLOWED_STATUS)[number];
export type ApprovalKind = (typeof ALLOWED_KIND)[number];
export type ApprovalRiskLevel = (typeof ALLOWED_RISK_LEVEL)[number];
export type AssigneeFilter = string | 'me' | 'unassigned';

export interface ApprovalFilters {
  readonly status?: ReadonlyArray<ApprovalStatus>;
  readonly kind?: ReadonlyArray<ApprovalKind>;
  readonly riskLevel?: ReadonlyArray<ApprovalRiskLevel>;
  readonly assignedTo?: AssigneeFilter;
}

export const DEFAULT_FILTERS: ApprovalFilters = {
  status: ['pending', 'escalated'],
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    'approvals.filter.suspicious_input',
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

function parseAssignee(raw: string | null | undefined): AssigneeFilter | undefined {
  if (!raw) return undefined;
  if (raw === 'me' || raw === 'unassigned') return raw;
  if (!UUID_RE.test(raw)) {
    logSuspicious({ field: 'assignedTo', raw, rejected: raw });
    return undefined;
  }
  return raw;
}

export interface ParsedApprovalsRequest {
  readonly filters: ApprovalFilters;
  readonly cursor?: string;
  /** True when the URL had no filter keys at all and we filled in defaults. */
  readonly defaulted: boolean;
}

export function parseApprovalFilters(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
): ParsedApprovalsRequest {
  const get = (key: string): string | null => {
    if (searchParams instanceof URLSearchParams) {
      return searchParams.get(key);
    }
    const v = searchParams[key];
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && v.length > 0) return v[0] ?? null;
    return null;
  };

  const explicit: ApprovalFilters = {
    ...maybe('status', parseAllowList('status', get('status'), ALLOWED_STATUS)),
    ...maybe('kind', parseAllowList('kind', get('kind'), ALLOWED_KIND)),
    ...maybe('riskLevel', parseAllowList('riskLevel', get('riskLevel'), ALLOWED_RISK_LEVEL)),
    ...maybe('assignedTo', parseAssignee(get('assignedTo'))),
  };

  const cursor = get('cursor') ?? undefined;
  const hasAny = Object.keys(explicit).length > 0;

  // When the URL is blank, apply defaults so the first /approvals load
  // surfaces actionable items. Any explicit filter (even one) opts out
  // of defaults — the URL becomes authoritative.
  if (!hasAny && !cursor) {
    return {
      filters: DEFAULT_FILTERS,
      defaulted: true,
    };
  }

  return {
    filters: explicit,
    defaulted: false,
    ...maybe('cursor', cursor),
  };
}

function maybe<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export function encodeApprovalFilters(
  filters: ApprovalFilters,
  options?: { cursor?: string },
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status?.length) params.set('status', filters.status.join(','));
  if (filters.kind?.length) params.set('kind', filters.kind.join(','));
  if (filters.riskLevel?.length) params.set('riskLevel', filters.riskLevel.join(','));
  if (filters.assignedTo) params.set('assignedTo', filters.assignedTo);
  if (options?.cursor) params.set('cursor', options.cursor);
  return params;
}

export function hasActiveFilters(f: ApprovalFilters): boolean {
  return Boolean(
    f.status?.length || f.kind?.length || f.riskLevel?.length || f.assignedTo,
  );
}
