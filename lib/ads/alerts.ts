/**
 * Ads-alert heuristics — Phase 8 / Commit 29.
 *
 * Pure sync functions. Producer (`lib/jobs/ads-alerts-scan.ts`)
 * fetches per-account rollups, hands them here, and decides
 * whether to upsert into `ads_alerts`.
 *
 * **REGLA BLACKNEL AI-FEEDBACK PATTERN.** Real-time / per-tick
 * signals use heuristic sync, no AI call. AI is reserved for
 * authoritative gates at submit time. These alerts run on a
 * 12h cron — no IA invoked.
 *
 * # Statistical floors (Ajuste 1)
 *
 * Statistical floors prevent noise-driven alerts in small
 * accounts. A test account with 50 impressions/day can have
 * wild CTR swings that aren't actionable. Real degradation
 * signals require enough sample size to be confident.
 *
 * These floors are calibrated for Phase 8 mock data. Phase 11
 * with real account volume should re-calibrate based on
 * observed alert precision.
 *
 * **CTR-drop alert:**
 *   - baseline 7d impressions >= 1000
 *   - baseline 7d clicks      >= 20
 *   - baseline 7d CTR         >= 0.005 (0.5%)
 *   - current CTR             <  baseline CTR × 0.5
 *
 * **Spend-spike alert:**
 *   - median 7d spend         >= $5 USD/day
 *   - today's spend           >  median × 2
 *
 * **Account-error alert:**
 *   - account status='error' for >= 24h continuous
 *   - NO floor — binary infra signal, always actionable
 */

export type AdsAlertKind =
  | 'ctr_drop'
  | 'spend_spike'
  | 'account_error'
  | 'budget_anomaly_reserved';

export type AdsAlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertSignal {
  readonly kind: AdsAlertKind;
  readonly severity: AdsAlertSeverity;
  readonly title: string;
  readonly body: string;
  readonly evidence: Record<string, unknown>;
}

export interface AlertEvaluation {
  /**
   * Per-account aggregations the producer fetched. All counts
   * are in the account's NATIVE currency for spend; impressions
   * and clicks are platform-reported integers.
   */
  readonly baseline7d: {
    readonly impressions: number;
    readonly clicks: number;
    readonly medianDailySpendUsdCents: number;
  };
  readonly today: {
    readonly impressions: number;
    readonly clicks: number;
    readonly spendUsdCents: number;
  };
  /**
   * Account status. Used by the error-detector. `errorSince` is
   * the timestamp the row first flipped to `status='error'`; the
   * producer reads this from `ads_accounts.updated_at` when the
   * status transitioned there. `null` means the account is
   * currently healthy.
   */
  readonly accountStatus: 'connected' | 'disconnected' | 'error';
  readonly errorSince: Date | null;
  /** Caller passes `now()` so the function stays pure-testable. */
  readonly now: Date;
}

// ---------------------------------------------------------------------------
// Floor constants — exported so tests can pin behavior
// ---------------------------------------------------------------------------

export const CTR_DROP_MIN_IMPRESSIONS = 1000;
export const CTR_DROP_MIN_CLICKS = 20;
export const CTR_DROP_MIN_BASELINE_CTR = 0.005; // 0.5%
export const CTR_DROP_RATIO = 0.5; // current < baseline × 0.5

export const SPEND_SPIKE_MIN_MEDIAN_USD_CENTS = 500; // $5/day
export const SPEND_SPIKE_RATIO = 2; // today > median × 2

export const ACCOUNT_ERROR_MIN_DURATION_MS = 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Evaluate one account against every heuristic. Returns an
 * array (0..N signals). The producer maps each signal 1:1 to an
 * `ads_alerts` row.
 *
 * Pure function: no DB reads, no clock reads, no console
 * output. Caller passes `now` so tests can pin time.
 */
export function evaluateAdsAlerts(input: AlertEvaluation): AlertSignal[] {
  const out: AlertSignal[] = [];

  const ctr = detectCtrDrop(input);
  if (ctr) out.push(ctr);

  const spike = detectSpendSpike(input);
  if (spike) out.push(spike);

  const errSignal = detectAccountError(input);
  if (errSignal) out.push(errSignal);

  return out;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

function detectCtrDrop(input: AlertEvaluation): AlertSignal | null {
  const { baseline7d, today } = input;
  if (baseline7d.impressions < CTR_DROP_MIN_IMPRESSIONS) return null;
  if (baseline7d.clicks < CTR_DROP_MIN_CLICKS) return null;

  const baselineCtr = baseline7d.clicks / baseline7d.impressions;
  if (baselineCtr < CTR_DROP_MIN_BASELINE_CTR) return null;

  // If today has zero impressions we can't compute a CTR — skip.
  if (today.impressions === 0) return null;
  const currentCtr = today.clicks / today.impressions;

  if (currentCtr >= baselineCtr * CTR_DROP_RATIO) return null;

  const dropPct = ((baselineCtr - currentCtr) / baselineCtr) * 100;
  // Severity tiering: 50%-65% drop = medium ; 65%-80% = high ;
  // >80% = critical. Calibrated against the floors so a
  // just-over-threshold drop doesn't auto-escalate to critical.
  let severity: AdsAlertSeverity = 'medium';
  if (dropPct >= 80) severity = 'critical';
  else if (dropPct >= 65) severity = 'high';

  return {
    kind: 'ctr_drop',
    severity,
    title: 'CTR cayó significativamente vs últimos 7 días',
    body:
      `CTR hoy ${(currentCtr * 100).toFixed(2)}% — baseline 7d ${(baselineCtr * 100).toFixed(2)}%. ` +
      `Caída del ${dropPct.toFixed(0)}% sobre ${baseline7d.impressions.toLocaleString('en-US')} impressions baseline.`,
    evidence: {
      baselineCtr,
      currentCtr,
      dropPct,
      baselineImpressions: baseline7d.impressions,
      baselineClicks: baseline7d.clicks,
      todayImpressions: today.impressions,
      todayClicks: today.clicks,
    },
  };
}

function detectSpendSpike(input: AlertEvaluation): AlertSignal | null {
  const { baseline7d, today } = input;
  if (
    baseline7d.medianDailySpendUsdCents < SPEND_SPIKE_MIN_MEDIAN_USD_CENTS
  ) {
    return null;
  }
  const threshold = baseline7d.medianDailySpendUsdCents * SPEND_SPIKE_RATIO;
  if (today.spendUsdCents <= threshold) return null;

  const ratio = today.spendUsdCents / baseline7d.medianDailySpendUsdCents;
  let severity: AdsAlertSeverity = 'medium';
  if (ratio >= 5) severity = 'critical';
  else if (ratio >= 3) severity = 'high';

  return {
    kind: 'spend_spike',
    severity,
    title: 'Spend de hoy supera 2x la mediana de los últimos 7 días',
    body:
      `Hoy: $${(today.spendUsdCents / 100).toFixed(2)} USD · ` +
      `Mediana 7d: $${(baseline7d.medianDailySpendUsdCents / 100).toFixed(2)} USD ` +
      `(${ratio.toFixed(1)}x).`,
    evidence: {
      todaySpendUsdCents: today.spendUsdCents,
      medianDailySpendUsdCents: baseline7d.medianDailySpendUsdCents,
      ratio,
    },
  };
}

function detectAccountError(input: AlertEvaluation): AlertSignal | null {
  if (input.accountStatus !== 'error') return null;
  if (!input.errorSince) return null;
  const durationMs = input.now.getTime() - input.errorSince.getTime();
  if (durationMs < ACCOUNT_ERROR_MIN_DURATION_MS) return null;

  // No floor — every long-running error is actionable. Severity
  // grows with duration: 24h-48h = high, >48h = critical.
  const severity: AdsAlertSeverity =
    durationMs >= 48 * 60 * 60_000 ? 'critical' : 'high';

  return {
    kind: 'account_error',
    severity,
    title: 'La cuenta de ads está en error desde hace más de 24 horas',
    body:
      `Status='error' desde ${input.errorSince.toISOString()}. ` +
      `Duración: ${Math.round(durationMs / 3_600_000)}h. ` +
      `Re-autenticá la cuenta o revisá el dashboard del proveedor.`,
    evidence: {
      errorSinceIso: input.errorSince.toISOString(),
      durationMs,
    },
  };
}
