/**
 * Pure helpers for the composer's UTM editor.
 *
 * Lives outside the Client component so it stays unit-testable
 * without dragging React in. The component (`utm-builder.tsx`)
 * imports `buildUtmUrl` to render its URL preview line; the
 * shell (`composer-shell.tsx`) imports `normalizeUtm` /
 * `emitUtm` to bridge editing state and the Server Action
 * payload.
 */

export interface UtmValues {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

const FIELDS: ReadonlyArray<keyof UtmValues> = [
  'source',
  'medium',
  'campaign',
  'term',
  'content',
];

export type UtmUrlPreview =
  | { kind: 'ok'; url: string }
  | { kind: 'invalid' }
  | { kind: 'empty' };

/**
 * Returns the URL with UTM params appended. Falsy outcomes:
 *
 *   - empty `link` → `{ kind: 'empty' }` (the user hasn't entered
 *     a URL yet; the composer renders a hint)
 *   - unparseable `link` → `{ kind: 'invalid' }` (the user
 *     entered text that isn't a URL)
 *
 * On the happy path:
 *
 *   - Existing query params on the input URL are preserved.
 *   - Existing `utm_*` keys are overwritten by the supplied
 *     values (composer is the source of truth for those).
 *   - Empty / whitespace-only UTM values are dropped — never
 *     emit `utm_source=` with nothing on the other side.
 *   - All values are `.trim()`ed before insertion so
 *     " facebook " becomes `utm_source=facebook`.
 */
export function buildUtmUrl(rawLink: string, utm: UtmValues): UtmUrlPreview {
  const trimmed = rawLink.trim();
  if (trimmed.length === 0) return { kind: 'empty' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: 'invalid' };
  }
  for (const field of FIELDS) {
    const value = utm[field]?.trim();
    if (value && value.length > 0) {
      url.searchParams.set(`utm_${field}`, value);
    }
  }
  return { kind: 'ok', url: url.toString() };
}

/**
 * Mirrors `buildUtmUrl`'s sanitization, but for the *payload* the
 * Server Action receives. Drops empty fields so the persisted
 * jsonb stays tidy and Zod's optional fields validate cleanly.
 */
export function emitUtm(utm: UtmValues): UtmValues {
  const out: UtmValues = {};
  for (const field of FIELDS) {
    const value = utm[field]?.trim();
    if (value && value.length > 0) out[field] = value;
  }
  return out;
}

/**
 * Defensive inverse: convert a persisted `posts.utm` jsonb (loose
 * `Record<string, unknown>`) into a strict `UtmValues`. Non-string
 * entries are dropped. Keeps the composer immune to bad data
 * lingering from older C17-era inserts.
 */
export function normalizeUtm(raw: Record<string, unknown> | null | undefined): UtmValues {
  if (!raw || typeof raw !== 'object') return {};
  const out: UtmValues = {};
  for (const field of FIELDS) {
    const value = (raw as Record<string, unknown>)[field];
    if (typeof value === 'string') out[field] = value;
  }
  return out;
}

/**
 * True when the in-memory `UtmValues` differs from the persisted
 * row (after both are normalized). Used by the composer's dirty
 * flag.
 */
export function utmDiffers(local: UtmValues, persisted: Record<string, unknown>): boolean {
  const norm = normalizeUtm(persisted);
  for (const field of FIELDS) {
    if ((local[field] ?? '') !== (norm[field] ?? '')) return true;
  }
  return false;
}
