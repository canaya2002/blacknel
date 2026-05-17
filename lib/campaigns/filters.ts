/**
 * /publish/campaigns URL filter contract (Commit 21).
 *
 * Same defensive posture as /inbox, /reviews, /reputation, /publish:
 * every value runs through an allow-list or UUID regex, and a single
 * bad value drops the whole filter (no partial acceptance — that
 * hides results from the user). Every reject logs
 * `campaigns.filter.suspicious_input` so a malformed URL doesn't
 * silently degrade the experience.
 */

import { log } from '../log';

import {
  CAMPAIGN_GOALS,
  CAMPAIGN_STATUSES,
  type CampaignGoal,
  type CampaignStatus,
} from './validate';

export interface CampaignFilters {
  readonly status?: ReadonlyArray<CampaignStatus>;
  readonly goal?: CampaignGoal;
  readonly brandId?: string;
  readonly q?: string;
  readonly startsFrom?: string;
  readonly startsTo?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_Q_LEN = 200;
const MAX_RANGE_DAYS = 365;

function logSuspicious(field: string, raw: string, reason: string): void {
  log.warn(
    { field, raw: raw.slice(0, 200), reason },
    'campaigns.filter.suspicious_input',
  );
}

function pickFirst(
  raw: string | ReadonlyArray<string> | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : (raw as string);
}

function parseStatusList(raw: string | undefined): ReadonlyArray<CampaignStatus> | undefined {
  if (!raw) return undefined;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  const valid = new Set<CampaignStatus>();
  for (const p of parts) {
    if ((CAMPAIGN_STATUSES as ReadonlyArray<string>).includes(p)) {
      valid.add(p as CampaignStatus);
    } else {
      logSuspicious('status', p, 'not_in_allow_list');
      return undefined;
    }
  }
  return Array.from(valid);
}

function parseGoal(raw: string | undefined): CampaignGoal | undefined {
  if (!raw) return undefined;
  if ((CAMPAIGN_GOALS as ReadonlyArray<string>).includes(raw)) {
    return raw as CampaignGoal;
  }
  logSuspicious('goal', raw, 'not_in_allow_list');
  return undefined;
}

function parseUuid(field: string, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!UUID_RE.test(raw)) {
    logSuspicious(field, raw, 'not_a_uuid');
    return undefined;
  }
  return raw;
}

function parseDate(field: string, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!DATE_RE.test(raw)) {
    logSuspicious(field, raw, 'not_yyyy_mm_dd');
    return undefined;
  }
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) {
    logSuspicious(field, raw, 'unparseable_date');
    return undefined;
  }
  return raw;
}

function parseQ(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > MAX_Q_LEN) {
    logSuspicious('q', trimmed, 'too_long');
    return undefined;
  }
  return trimmed;
}

export function parseCampaignFilters(
  searchParams: Record<string, string | string[] | undefined>,
): CampaignFilters {
  const status = parseStatusList(pickFirst(searchParams.status));
  const goal = parseGoal(pickFirst(searchParams.goal));
  const brandId = parseUuid('brandId', pickFirst(searchParams.brandId));
  const q = parseQ(pickFirst(searchParams.q));
  let startsFrom = parseDate('startsFrom', pickFirst(searchParams.startsFrom));
  let startsTo = parseDate('startsTo', pickFirst(searchParams.startsTo));

  // Pairwise validation. Same rule as /publish + /reviews — drop
  // both bounds if either fails or the range is out of bounds.
  if (startsFrom && startsTo) {
    const fromTs = Date.parse(startsFrom);
    const toTs = Date.parse(startsTo);
    if (fromTs > toTs) {
      logSuspicious('startsRange', `${startsFrom}..${startsTo}`, 'from_gt_to');
      startsFrom = undefined;
      startsTo = undefined;
    } else if ((toTs - fromTs) / 86_400_000 > MAX_RANGE_DAYS) {
      logSuspicious('startsRange', `${startsFrom}..${startsTo}`, 'range_too_wide');
      startsFrom = undefined;
      startsTo = undefined;
    }
  }

  return {
    ...(status ? { status } : {}),
    ...(goal ? { goal } : {}),
    ...(brandId ? { brandId } : {}),
    ...(q ? { q } : {}),
    ...(startsFrom ? { startsFrom } : {}),
    ...(startsTo ? { startsTo } : {}),
  };
}

export function hasActiveCampaignFilters(filters: CampaignFilters): boolean {
  return (
    (filters.status !== undefined && filters.status.length > 0) ||
    filters.goal !== undefined ||
    filters.brandId !== undefined ||
    filters.q !== undefined ||
    filters.startsFrom !== undefined ||
    filters.startsTo !== undefined
  );
}
