/**
 * Shared types + pure helpers for the composer preview stack
 * (Commit 19c.1).
 *
 * # Performance contract (Ajuste 19c.1)
 *
 *   1. Each `preview-<platform>.tsx` is wrapped in `React.memo`
 *      with `arePreviewPropsEqual` as the custom comparator
 *      below. Same `PreviewSlice` props twice → memo skips
 *      re-render.
 *
 *   2. Derived state (per-platform truncated body, char counts,
 *      effective text) lives in the SHELL's `useMemo`. Previews
 *      receive pre-computed primitive props (string / boolean /
 *      number / frozen array). No re-derivation inside previews.
 *
 *   3. Previews are pure — no `useState`, no `useEffect`, no
 *      `useTransition`. Everything they need arrives via props.
 */

import type { PlatformCode } from '@/lib/connectors/base';

export type PreviewMediaKind = 'image' | 'video' | 'gif' | 'pdf';

export interface PreviewMedia {
  readonly url: string;
  readonly kind: PreviewMediaKind;
  readonly name: string;
}

/**
 * Computed per-platform projection of the editing state. The shell
 * builds an array of these inside a `useMemo` and feeds each
 * preview its matching slice. Stable references across renders are
 * the responsibility of `useMemo` upstream.
 */
export interface PreviewSlice {
  /** Stable key — the `connected_account.id`. */
  readonly key: string;
  readonly platform: PlatformCode;
  /** Pre-truncated body for this platform (or the base if no truncation needed). */
  readonly body: string;
  /** True if a per-platform override is in effect. Drives the "override" pill. */
  readonly hasOverride: boolean;
  /** True if the effective text exceeds the platform's `maxTextLength`. */
  readonly over: boolean;
  /** Platform's declared char cap; `null` when none. */
  readonly charLimit: number | null;
  readonly length: number;
  readonly displayName: string;
  readonly handle: string | null;
  readonly link: string | null;
  /** Attached media. Reference is stable across renders that don't change media. */
  readonly media: ReadonlyArray<PreviewMedia>;
}

/**
 * Common props every preview component accepts. Each preview
 * additionally renders the slice with its own platform-fidelity
 * layout.
 */
export interface PreviewComponentProps {
  readonly slice: PreviewSlice;
}

// ---------------------------------------------------------------------------
// truncateBody / formatters
// ---------------------------------------------------------------------------

/**
 * If `body.length <= limit` (or `limit` is null), returns body
 * unchanged. Otherwise truncates to `limit - 1` and appends "…".
 * The minus-1 keeps the final string at exactly `limit` chars
 * including the ellipsis so the preview character counter never
 * goes red AFTER truncation.
 */
export function truncateBody(body: string, limit: number | null): string {
  if (limit === null) return body;
  if (body.length <= limit) return body;
  if (limit <= 1) return body.slice(0, limit);
  return body.slice(0, limit - 1) + '…';
}

/**
 * Best-effort initials for the avatar fallback. Drops emojis and
 * uses the first letter of the first two whitespace-separated
 * tokens.
 */
export function initialsFor(displayName: string | null, handle: string | null): string {
  const raw = (displayName ?? handle ?? '?').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (raw.length === 0) return '?';
  const tokens = raw.split(/\s+/).slice(0, 2);
  const first = tokens[0]?.[0] ?? '?';
  const second = tokens[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

/**
 * Stable "Just now" / "5m" / "2h" label for the preview footer.
 * Phase 11 wiring real timestamps will swap this for `date-fns-tz`
 * (or our existing `lib/publish/calendar-grid` helpers); the
 * preview never persists time so the noise of full ISO formatting
 * isn't worth it.
 */
export function formatRelativeTime(date: Date | null, now: Date): string {
  if (!date) return 'Justo ahora';
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return 'Justo ahora';
  if (diffMs < 60 * 60_000) return `${Math.round(diffMs / 60_000)}m`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.round(diffMs / (60 * 60_000))}h`;
  return `${Math.round(diffMs / (24 * 60 * 60_000))}d`;
}

// ---------------------------------------------------------------------------
// Equality (memo comparator)
// ---------------------------------------------------------------------------

/**
 * Shallow array equality for `mediaUrls` and similar primitive
 * arrays. Reference-eq first (the shell's `useMemo` keeps refs
 * stable when content is stable), then per-element strict eq.
 */
export function arrayEqShallow<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Media-list eq comparing primitive fields (url + kind + name).
 * Used by the preview memo comparator.
 */
export function mediaEq(
  a: ReadonlyArray<PreviewMedia>,
  b: ReadonlyArray<PreviewMedia>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai.url !== bi.url || ai.kind !== bi.kind || ai.name !== bi.name) return false;
  }
  return true;
}

/**
 * Custom comparator for `React.memo`. Returns `true` when the
 * preview should skip its re-render — i.e., when the rendered
 * output would be identical to the previous render.
 *
 * Compares the fields the preview actually paints:
 *   body, hasOverride, over, charLimit, length, displayName,
 *   handle, link, media (deep), platform (defensive — should
 *   never change for a given slice key, but guard anyway).
 *
 * `key` is excluded — that's React's own slot identifier and
 * changing it would unmount the component, not re-render it.
 */
export function arePreviewPropsEqual(
  prev: PreviewComponentProps,
  next: PreviewComponentProps,
): boolean {
  const a = prev.slice;
  const b = next.slice;
  if (a === b) return true;
  return (
    a.platform === b.platform &&
    a.body === b.body &&
    a.hasOverride === b.hasOverride &&
    a.over === b.over &&
    a.charLimit === b.charLimit &&
    a.length === b.length &&
    a.displayName === b.displayName &&
    a.handle === b.handle &&
    a.link === b.link &&
    mediaEq(a.media, b.media)
  );
}

// ---------------------------------------------------------------------------
// Platform display
// ---------------------------------------------------------------------------

export const PLATFORM_DISPLAY: Partial<
  Record<
    PlatformCode,
    {
      readonly label: string;
      /** Tailwind class for the platform's brand color (used in headers + dot). */
      readonly accentClass: string;
      /** Subtle background for the preview card chrome. */
      readonly chromeClass: string;
    }
  >
> = {
  facebook: {
    label: 'Facebook',
    accentClass: 'text-blue-600',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
  instagram: {
    label: 'Instagram',
    accentClass: 'text-pink-600',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
  gbp: {
    label: 'Google Business',
    accentClass: 'text-emerald-600',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
  x: {
    label: 'X',
    accentClass: 'text-zinc-900 dark:text-zinc-100',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
  linkedin: {
    label: 'LinkedIn',
    accentClass: 'text-sky-700',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
  tiktok: {
    label: 'TikTok',
    accentClass: 'text-zinc-900 dark:text-zinc-100',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
  pinterest: {
    label: 'Pinterest',
    accentClass: 'text-red-600',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
  youtube: {
    label: 'YouTube',
    accentClass: 'text-red-600',
    chromeClass: 'bg-white dark:bg-zinc-900',
  },
};
