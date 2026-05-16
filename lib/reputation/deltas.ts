/**
 * KPI delta math (Ajuste 3). A delta compares two windows of the
 * same length — current vs prior. The rule that drives the UI is
 * "don't lie when there isn't enough data".
 *
 * When the prior window has < 3 reviews, we return `state: 'na'`.
 * Showing "+200%" because the prior window had 1 review and the
 * current has 3 is statistical theatre, not signal. The card then
 * renders "N/A — datos insuficientes" instead of a fake delta.
 *
 * When both windows have ≥3 reviews, the absolute delta is returned
 * with a `direction`: 'up' / 'down' / 'flat'. "flat" is reserved for
 * literal equality (|delta| < EPSILON) so a "+0.0 vs período anterior"
 * doesn't read as an improvement.
 */

export type DeltaState = 'ready' | 'na';
export type DeltaDirection = 'up' | 'down' | 'flat';

export interface DeltaResult {
  readonly state: DeltaState;
  /** Absolute (not percent) difference: `current - previous`. */
  readonly delta: number | null;
  readonly direction: DeltaDirection | null;
  /** Reason copy for state='na' — shown verbatim by the UI. */
  readonly naReason: string | null;
}

const MIN_PRIOR_REVIEWS = 3;
const EPSILON = 1e-6;

export interface ComputeDeltaInput {
  current: number;
  previous: number;
  /** How many reviews backed the prior window. Drives the "insufficient" check. */
  previousSampleSize: number;
}

export function computeDelta(input: ComputeDeltaInput): DeltaResult {
  if (input.previousSampleSize < MIN_PRIOR_REVIEWS) {
    return {
      state: 'na',
      delta: null,
      direction: null,
      naReason:
        'Datos insuficientes en el período anterior — al menos 3 reseñas requeridas.',
    };
  }
  const delta = input.current - input.previous;
  const absDelta = Math.abs(delta);
  const direction: DeltaDirection =
    absDelta < EPSILON ? 'flat' : delta > 0 ? 'up' : 'down';
  return { state: 'ready', delta, direction, naReason: null };
}

/**
 * Convenience: return the right tone class for a delta + an explicit
 * "good direction" hint. For rating, `up` is good (higher = better),
 * but for response time `down` is good (faster = better).
 *
 * Returns one of `'positive' | 'negative' | 'neutral'` so the UI
 * picks the right tailwind tone. `'neutral'` covers flat + na.
 */
export type DeltaTone = 'positive' | 'negative' | 'neutral';

export function deltaTone(
  delta: DeltaResult,
  goodDirection: 'up' | 'down',
): DeltaTone {
  if (delta.state === 'na' || delta.direction === 'flat' || delta.direction === null) {
    return 'neutral';
  }
  return delta.direction === goodDirection ? 'positive' : 'negative';
}
