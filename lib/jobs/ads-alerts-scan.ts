import 'server-only';

import { and, eq, gte, sql } from 'drizzle-orm';

import { dbAdmin, type AnyPgTx } from '@/lib/db/client';
import {
  adsAccounts,
  adsAlerts,
  adsSpendDaily,
  auditEvents,
  organizations,
} from '@/lib/db/schema';
import { log } from '@/lib/log';
import { ok, type Result } from '@/lib/types/result';
import {
  evaluateAdsAlerts,
  type AdsAlertKind,
  type AdsAlertSeverity,
  type AlertSignal,
} from '@/lib/ads/alerts';

/**
 * Ads-alerts producer — Phase 8 / Commit 29.
 *
 * Runs every 12h (`ADS_ALERTS_TICK_INTERVAL_MS`). For each
 * connected `ads_accounts`, computes baseline-7d + today
 * aggregates from `ads_spend_daily`, hands them to the pure
 * heuristic `evaluateAdsAlerts`, and upserts pending rows into
 * `ads_alerts`.
 *
 * # Merge window — 48h (Ajuste 2)
 *
 * Crisis-scan uses a 7d merge window because reputation events
 * persist (a bad review stays bad). Ads performance is more
 * volatile day-to-day — a CTR drop genuinely *recovered* by day
 * 5 should not suppress a fresh CTR drop on day 6. We use **48h**
 * instead: any pending alert older than 2 days is no longer
 * considered "the same incident."
 *
 * Same `growthRate >= 0.30` dedup threshold as crisis. The
 * "ids" set is the heuristic's evidence — for CTR drop we
 * compare the new vs old `dropPct`; for spend spike the `ratio`;
 * for account error the duration. If the new severity is higher
 * we ESCALATE and refresh evidence; if lower or similar we SKIP.
 */

const SCAN_BASELINE_DAYS = 7;
const MERGE_WINDOW_MS = 48 * 60 * 60_000;

export interface AdsAlertsScanDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  now: () => Date;
}

const defaultDeps: AdsAlertsScanDeps = {
  asAdmin: (fn) => dbAdmin(fn),
  now: () => new Date(),
};

export interface AdsAlertsScanReport {
  readonly orgsScanned: number;
  readonly accountsScanned: number;
  readonly alertsCreated: number;
  readonly alertsEscalated: number;
  readonly skippedDuplicates: number;
  readonly durationMs: number;
}

export async function runAdsAlertsScanTick(
  deps: AdsAlertsScanDeps = defaultDeps,
): Promise<Result<AdsAlertsScanReport>> {
  const startMs = deps.now().getTime();

  type OrgRow = { id: string };
  const orgs = await deps.asAdmin<OrgRow[]>((tx) =>
    tx.select({ id: organizations.id }).from(organizations).limit(500),
  );

  let accountsScanned = 0;
  let alertsCreated = 0;
  let alertsEscalated = 0;
  let skippedDuplicates = 0;

  for (const o of orgs) {
    try {
      const orgReport = await scanOrg(deps, o.id);
      accountsScanned += orgReport.accountsScanned;
      alertsCreated += orgReport.alertsCreated;
      alertsEscalated += orgReport.alertsEscalated;
      skippedDuplicates += orgReport.skippedDuplicates;
    } catch (e) {
      log.error(
        { err: (e as Error).message, orgId: o.id },
        'ads.alerts.scan.org_failed',
      );
    }
  }

  const report: AdsAlertsScanReport = {
    orgsScanned: orgs.length,
    accountsScanned,
    alertsCreated,
    alertsEscalated,
    skippedDuplicates,
    durationMs: deps.now().getTime() - startMs,
  };
  log.info({ tick: 'ads-alerts', ...report }, 'ads-alerts tick completed');
  return ok(report);
}

// ---------------------------------------------------------------------------
// Per-org scan
// ---------------------------------------------------------------------------

interface OrgScanReport {
  accountsScanned: number;
  alertsCreated: number;
  alertsEscalated: number;
  skippedDuplicates: number;
}

async function scanOrg(
  deps: AdsAlertsScanDeps,
  orgId: string,
): Promise<OrgScanReport> {
  type AccountRow = {
    id: string;
    organizationId: string;
    brandId: string | null;
    status: 'connected' | 'disconnected' | 'error';
    updatedAt: Date;
  };
  const accounts = await deps.asAdmin<AccountRow[]>((tx) =>
    tx
      .select({
        id: adsAccounts.id,
        organizationId: adsAccounts.organizationId,
        brandId: adsAccounts.brandId,
        status: adsAccounts.status,
        updatedAt: adsAccounts.updatedAt,
      })
      .from(adsAccounts)
      .where(eq(adsAccounts.organizationId, orgId)),
  );

  let alertsCreated = 0;
  let alertsEscalated = 0;
  let skippedDuplicates = 0;

  const now = deps.now();
  const baselineSince = new Date(now.getTime() - SCAN_BASELINE_DAYS * 86_400_000);
  const todayIso = now.toISOString().slice(0, 10);
  const baselineIso = baselineSince.toISOString().slice(0, 10);

  for (const acc of accounts) {
    // Baseline-7d aggregations. Percentile over per-day totals is
    // an ordered-set aggregate — the inline SQL keeps the syntax
    // readable and avoids drizzle's nested-subquery alias dance.
    type Baseline = {
      impressions: number;
      clicks: number;
      medianSpend: number;
    };
    const baselineRows = await deps.asAdmin<Baseline[]>((tx) =>
      tx.execute(sql`
        with per_day as (
          select
            date,
            sum(spend_usd_cents)::int as daily_spend,
            sum(impressions)::int     as daily_imps,
            sum(clicks)::int          as daily_clicks
          from ads_spend_daily
          where organization_id = ${orgId}
            and ads_account_id  = ${acc.id}
            and date           >= ${baselineIso}
            and date           <  ${todayIso}
          group by date
        )
        select
          coalesce(sum(daily_imps), 0)::int   as impressions,
          coalesce(sum(daily_clicks), 0)::int as clicks,
          coalesce(
            percentile_cont(0.5) within group (order by daily_spend),
            0
          )::int as "medianSpend"
        from per_day
      `),
    );
    // Drizzle's `tx.execute` returns `{ rows: ... }` on
    // postgres-js and a plain array on pglite. Normalize.
    const rawRows = (
      Array.isArray(baselineRows)
        ? baselineRows
        : (baselineRows as unknown as { rows?: Baseline[] }).rows ?? []
    ) as Baseline[];
    const baseline = rawRows[0] ?? {
      impressions: 0,
      clicks: 0,
      medianSpend: 0,
    };

    type Today = {
      impressions: string | number | null;
      clicks: string | number | null;
      spend: string | number | null;
    };
    const todayRows = await deps.asAdmin<Today[]>((tx) =>
      tx
        .select({
          impressions: sql<number>`coalesce(sum(${adsSpendDaily.impressions}), 0)`,
          clicks: sql<number>`coalesce(sum(${adsSpendDaily.clicks}), 0)`,
          spend: sql<number>`coalesce(sum(${adsSpendDaily.spendUsdCents}), 0)`,
        })
        .from(adsSpendDaily)
        .where(
          and(
            eq(adsSpendDaily.organizationId, orgId),
            eq(adsSpendDaily.adsAccountId, acc.id),
            eq(adsSpendDaily.date, todayIso),
          ),
        ),
    );
    const today = todayRows[0] ?? { impressions: 0, clicks: 0, spend: 0 };

    const signals = evaluateAdsAlerts({
      baseline7d: {
        impressions: Number(baseline.impressions ?? 0),
        clicks: Number(baseline.clicks ?? 0),
        medianDailySpendUsdCents: Number(baseline.medianSpend ?? 0),
      },
      today: {
        impressions: Number(today.impressions ?? 0),
        clicks: Number(today.clicks ?? 0),
        spendUsdCents: Number(today.spend ?? 0),
      },
      accountStatus: acc.status,
      // Approximation for `errorSince`: when an account's
      // `status` last flipped, `updated_at` is the most recent
      // pointer we have. Phase 9 may dedicate a column if we
      // start tracking the exact transition timestamp.
      errorSince: acc.status === 'error' ? acc.updatedAt : null,
      now,
    });

    for (const signal of signals) {
      const outcome = await mergeSignal(deps, orgId, acc, signal);
      if (outcome === 'created') alertsCreated += 1;
      else if (outcome === 'escalated') alertsEscalated += 1;
      else skippedDuplicates += 1;
    }
  }

  return {
    accountsScanned: accounts.length,
    alertsCreated,
    alertsEscalated,
    skippedDuplicates,
  };
}

// ---------------------------------------------------------------------------
// Merge logic — 48h window per Ajuste 2
// ---------------------------------------------------------------------------

type MergeOutcome = 'created' | 'escalated' | 'skipped_duplicate';

interface AccountRowLite {
  id: string;
  brandId: string | null;
}

const SEVERITY_RANK: Readonly<Record<AdsAlertSeverity, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

async function mergeSignal(
  deps: AdsAlertsScanDeps,
  orgId: string,
  acc: AccountRowLite,
  signal: AlertSignal,
): Promise<MergeOutcome> {
  const since = new Date(deps.now().getTime() - MERGE_WINDOW_MS);

  type ExistingRow = {
    id: string;
    severity: AdsAlertSeverity;
    evidence: unknown;
    createdAt: Date;
  };
  const existingRows = await deps.asAdmin<ExistingRow[]>((tx) =>
    tx
      .select({
        id: adsAlerts.id,
        severity: adsAlerts.severity,
        evidence: adsAlerts.evidence,
        createdAt: adsAlerts.createdAt,
      })
      .from(adsAlerts)
      .where(
        and(
          eq(adsAlerts.organizationId, orgId),
          eq(adsAlerts.adsAccountId, acc.id),
          eq(adsAlerts.kind, signal.kind as AdsAlertKind),
          eq(adsAlerts.status, 'pending'),
          gte(adsAlerts.createdAt, since),
        ),
      )
      .limit(1),
  );
  const existing = existingRows[0] ?? null;

  if (!existing) {
    const inserted = await deps.asAdmin<Array<{ id: string }>>((tx) =>
      tx
        .insert(adsAlerts)
        .values({
          organizationId: orgId,
          adsAccountId: acc.id,
          ...(acc.brandId ? { brandId: acc.brandId } : {}),
          kind: signal.kind,
          severity: signal.severity,
          title: signal.title,
          body: signal.body,
          evidence: signal.evidence,
          status: 'pending',
        })
        .returning({ id: adsAlerts.id }),
    );
    const id = inserted[0]!.id;
    await writeSystemAudit(deps, orgId, {
      action: 'ads_alert.created',
      entityId: id,
      after: { kind: signal.kind, severity: signal.severity },
    });
    return 'created';
  }

  // Escalate if the new signal raises severity.
  if (SEVERITY_RANK[signal.severity] > SEVERITY_RANK[existing.severity]) {
    await deps.asAdmin((tx) =>
      tx
        .update(adsAlerts)
        .set({
          severity: signal.severity,
          title: signal.title,
          body: signal.body,
          evidence: signal.evidence,
          updatedAt: deps.now(),
        })
        .where(eq(adsAlerts.id, existing.id)),
    );
    await writeSystemAudit(deps, orgId, {
      action: 'ads_alert.escalated',
      entityId: existing.id,
      before: { severity: existing.severity },
      after: { severity: signal.severity, kind: signal.kind },
    });
    return 'escalated';
  }

  // Same or lower severity — skip the duplicate.
  return 'skipped_duplicate';
}

interface AuditInput {
  action: string;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

async function writeSystemAudit(
  deps: AdsAlertsScanDeps,
  orgId: string,
  input: AuditInput,
): Promise<void> {
  try {
    await deps.asAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: orgId,
        userId: null,
        actorType: 'system',
        action: input.action,
        entityType: 'ads_alert',
        entityId: input.entityId,
        ...(input.before ? { before: input.before } : {}),
        ...(input.after ? { after: input.after } : {}),
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    log.error(
      { cause, action: input.action, entityId: input.entityId },
      'ads.alerts.audit.failed',
    );
  }
}
