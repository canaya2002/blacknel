/**
 * Saved-reply variable substitution.
 *
 * The composer renders saved-reply bodies that contain `{placeholder}`
 * tokens. This module is the ONLY way to expand them. Two reasons it lives
 * in isolation:
 *
 *   1. Whitelist enforcement. We refuse anything outside the explicit set
 *      below — no `{eval}`, no `{constructor}`, no `{__proto__}`. The
 *      function throws on first offender so an unknown placeholder cannot
 *      silently fall through (which would leak `{secret_key}` placeholders
 *      to customers).
 *
 *   2. Plain `String#replace`. Never `eval`, never template literals,
 *      never `new Function`. The body is text, the values are text, the
 *      output is text — no execution path exists.
 *
 * The placeholder grammar is intentionally narrow: `\{<identifier>\}` with
 * identifiers limited to `[A-Za-z_][A-Za-z0-9_]*`. Anything that doesn't
 * match (parens, dollar signs, dots, dashes) is left in the body as-is —
 * not interpreted, not stripped. That keeps prose like "Open at {8h-22h}"
 * safe from accidental substitution and from accidental rejection.
 */

export const ALLOWED_VARIABLES = [
  'customer_name',
  'location_name',
  'business_hours',
  'phone',
  'link',
] as const;
export type AllowedVariable = (typeof ALLOWED_VARIABLES)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_VARIABLES);

/** Match `{identifier}` only — no parens, no dots, no dollar signs. */
const PLACEHOLDER_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export class UnsafeTemplateVariableError extends Error {
  constructor(public readonly variable: string) {
    super(
      `Saved-reply template referenced an un-allowlisted variable: "${variable}". ` +
        `Allowed: ${ALLOWED_VARIABLES.join(', ')}.`,
    );
    this.name = 'UnsafeTemplateVariableError';
  }
}

export type SubstitutionValues = Partial<Record<AllowedVariable, string>>;

/**
 * Replace every recognised placeholder. Throws `UnsafeTemplateVariableError`
 * on the first placeholder that names a variable outside the allow-list —
 * fail-closed beats fail-open every time. Missing values for an allowed
 * variable become the empty string; callers that want a stricter "missing
 * value is an error" mode should pre-validate `values`.
 */
export function substituteSavedReplyVariables(
  template: string,
  values: SubstitutionValues,
): string {
  return template.replace(PLACEHOLDER_RE, (_match, name: string) => {
    if (!ALLOWED_SET.has(name)) {
      throw new UnsafeTemplateVariableError(name);
    }
    const value = values[name as AllowedVariable];
    return value ?? '';
  });
}

/**
 * Returns the unique allowed placeholders referenced by a template, in
 * insertion order. Useful for the composer's UI ("this reply asks for:
 * customer_name, location_name"). Does NOT throw on un-allowlisted
 * placeholders — those are simply omitted from the output. The
 * substitution path is the only enforcement layer.
 */
export function extractVariablesUsed(template: string): ReadonlyArray<AllowedVariable> {
  const out: AllowedVariable[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    const name = match[1]!;
    if (ALLOWED_SET.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name as AllowedVariable);
    }
  }
  return out;
}

/**
 * Lenient counterpart of `substituteSavedReplyVariables`: replaces ONLY
 * the placeholders for which `values` provides a non-null, non-empty
 * value. Anything else — unknown identifiers, allowed-but-unprovided
 * variables — stays in the body verbatim so the composer can highlight
 * it for the user.
 *
 * Used at saved-reply insertion time. The strict variant
 * (`substituteSavedReplyVariables`) is no longer the right tool there
 * because we WANT the unfilled `{link}` to remain visible.
 *
 * Security note: unlike the strict variant, this does NOT throw on
 * non-whitelisted identifiers — they simply aren't touched. The
 * `findUnresolvedPlaceholders` checker below still rejects only
 * whitelisted names, so a stray `{eval(x)}` in the body remains
 * inert text the user can read and edit before sending.
 */
export function autoFillKnownPlaceholders(
  template: string,
  values: SubstitutionValues,
): string {
  return template.replace(PLACEHOLDER_RE, (match, name: string) => {
    if (!ALLOWED_SET.has(name)) return match;
    const value = values[name as AllowedVariable];
    if (value === undefined || value === null || value === '') {
      // Leave the placeholder intact so the UI can mark it pending.
      return match;
    }
    return value;
  });
}

/**
 * Return the list of allowed placeholders still present in `body`.
 * Drives:
 *
 *   - The composer's yellow-highlight UI ("you have {link} left").
 *   - The Send button's disabled state.
 *   - The server-side rejection in `lib/inbox/send-reply.ts`. If the
 *     submitted body still references whitelisted placeholders, the
 *     Server Action throws `AppError('UNRESOLVED_PLACEHOLDERS')` with
 *     the offending list — defense in depth against a client bypass.
 */
export function findUnresolvedPlaceholders(
  body: string,
): ReadonlyArray<AllowedVariable> {
  const out: AllowedVariable[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  PLACEHOLDER_RE.lastIndex = 0;
  while ((match = PLACEHOLDER_RE.exec(body)) !== null) {
    const name = match[1]!;
    if (ALLOWED_SET.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push(name as AllowedVariable);
    }
  }
  return out;
}
