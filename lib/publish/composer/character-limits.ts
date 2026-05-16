import { getCapabilities } from '@/lib/connectors/registry';
import type { PlatformCode, PublishLimits } from '@/lib/connectors/base';

/**
 * Pure helpers for the composer's character-limit UI. Each platform
 * declares its own limit via `PublishLimits.maxTextLength` on the
 * connector capabilities — no global table. The composer reads
 * those values via `getCapabilities(platform).publishLimits` so a
 * 2026-Q1 limit change in one connector doesn't ripple anywhere.
 *
 * Two views the composer wants:
 *
 *   1. The strictest limit across the currently selected accounts —
 *      drives the "X / N" counter under the base text editor.
 *   2. Per-account usage map — drives the limits bar that shows
 *      which platforms are about to overflow.
 *
 * The "effective text" for a platform is the platform's variant
 * when set, falling back to the base text. The caller threads the
 * variants map; this module stays pure.
 */

export interface AccountLimitInput {
  /** Connected-account id — the key the variants map uses. */
  readonly accountId: string;
  readonly platform: PlatformCode;
}

export interface AccountLimitUsage {
  readonly accountId: string;
  readonly platform: PlatformCode;
  /** Effective text length applied for this account. */
  readonly length: number;
  /** Platform max — `null` when the platform doesn't declare one. */
  readonly maxLength: number | null;
  /** True when `length > maxLength`. */
  readonly over: boolean;
  /** Length remaining; `null` when no max declared. Floors at 0. */
  readonly remaining: number | null;
}

export interface ComputeLimitOpts {
  /** Base post text — the per-platform variants fall back to this. */
  readonly baseText: string;
  /** Per-account overrides keyed by `accountId`. Empty string falls back. */
  readonly variants: Readonly<Record<string, string | undefined>>;
  /** Accounts currently selected as publish targets. */
  readonly accounts: ReadonlyArray<AccountLimitInput>;
}

/**
 * Returns one row per selected account with effective length vs
 * platform max. Order matches `opts.accounts` so the bar UI can
 * render a stable column order.
 */
export function computeAccountUsages(opts: ComputeLimitOpts): ReadonlyArray<AccountLimitUsage> {
  return opts.accounts.map((account) => {
    const text = effectiveTextFor(account.accountId, opts);
    const limit = getPublishLimitsFor(account.platform);
    const maxLength = limit?.maxTextLength ?? null;
    const length = text.length;
    const over = maxLength !== null && length > maxLength;
    const remaining = maxLength !== null ? Math.max(0, maxLength - length) : null;
    return { accountId: account.accountId, platform: account.platform, length, maxLength, over, remaining };
  });
}

/**
 * Strictest declared maxTextLength across the selected accounts,
 * or `null` when no selected account declares one. Drives the base
 * editor's counter — it shows the floor so the user is guided
 * toward content that fits everywhere.
 */
export function strictestMaxLength(accounts: ReadonlyArray<AccountLimitInput>): number | null {
  let min: number | null = null;
  for (const a of accounts) {
    const max = getPublishLimitsFor(a.platform)?.maxTextLength;
    if (typeof max === 'number') {
      min = min === null ? max : Math.min(min, max);
    }
  }
  return min;
}

/**
 * True when every selected account either has no declared
 * `maxTextLength` or its effective text fits. Composer uses this
 * to enable / disable the "Schedule" CTA — exceeding any platform
 * means the post can't be scheduled across all targets.
 */
export function isWithinAllLimits(opts: ComputeLimitOpts): boolean {
  return computeAccountUsages(opts).every((u) => !u.over);
}

/** Per-platform limit lookup. Defensive: unknown platform → no limits. */
export function getPublishLimitsFor(platform: PlatformCode): PublishLimits | undefined {
  try {
    return getCapabilities(platform).publishLimits;
  } catch {
    return undefined;
  }
}

function effectiveTextFor(accountId: string, opts: ComputeLimitOpts): string {
  const variant = opts.variants[accountId];
  if (typeof variant === 'string' && variant.length > 0) return variant;
  return opts.baseText;
}
