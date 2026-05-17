'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { loadOverviewReport } from '@/lib/reports/queries';
import { parseReportFilters } from '@/lib/reports/period';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * CSV export for the Overview tab (Phase 8 / Commit 27, D-27-3
 * + Ajuste 3).
 *
 * Returns the CSV body as a string + a recommended filename.
 * The client component wraps it in a `<a download>` to trigger
 * the browser save dialog. No S3, no temp files — Phase 12
 * polish swaps to a Blob upload if the row counts exceed
 * what URI encoding can carry.
 *
 * **Audit (Ajuste 3).** Every export emits
 * `reports.csv.exported` with `{ section, period, brandId,
 * rowCount, sizeBytes }`. The LFPDPPP / GDPR compliance Phase
 * 11 needs the row-level "who exported what when" trail; this
 * is the lightweight Phase-8 version.
 */

const inputSchema = z.object({
  section: z.literal('overview'),
  period: z.enum(['7d', '30d', '90d']),
  brandId: z.string().uuid().nullable().optional(),
});

export interface ExportCsvSuccess {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly sizeBytes: number;
}

export async function exportOverviewCsvAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<ExportCsvSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'reports:export');

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Parámetros de export inválidos.');
  }
  const { section, period } = parsed.data;
  const brandId = parsed.data.brandId ?? null;

  const now = new Date();
  // Build the report by calling the same loader the dashboard
  // uses. NOT touching its body — Phase 8 charter rule.
  // Skip cache bypass (CSV exports always want fresh).
  const payload = await loadOverviewReport({
    orgId: session.orgId,
    userId: session.userId,
    period,
    brandId,
    now,
  });

  // Flatten into rows. Each metric is one CSV row with
  // {metric, current, previous, delta, trend, goodDirection}.
  const rows: ReadonlyArray<string[]> = [
    ['Metric', 'Current', 'Previous', 'Delta', 'Trend'],
    ['Response time (ms)', n(payload.responseTimeAvgMs.current), n(payload.responseTimeAvgMs.previous), n(payload.responseTimeAvgMs.delta), payload.responseTimeAvgMs.trend],
    ['Inbox threads', n(payload.inboxThreadCount.current), n(payload.inboxThreadCount.previous), n(payload.inboxThreadCount.delta), payload.inboxThreadCount.trend],
    ['Reviews avg rating', n(payload.reviewsAvg.current), n(payload.reviewsAvg.previous), n(payload.reviewsAvg.delta), payload.reviewsAvg.trend],
    ['Reviews count', n(payload.reviewsCount.current), n(payload.reviewsCount.previous), n(payload.reviewsCount.delta), payload.reviewsCount.trend],
    ['Reviews response rate (%)', n(payload.reviewsResponseRate.current), n(payload.reviewsResponseRate.previous), n(payload.reviewsResponseRate.delta), payload.reviewsResponseRate.trend],
    ['Posts published', n(payload.postsPublishedCount.current), n(payload.postsPublishedCount.previous), n(payload.postsPublishedCount.delta), payload.postsPublishedCount.trend],
    ['Posts failed', n(payload.postsFailedCount.current), n(payload.postsFailedCount.previous), n(payload.postsFailedCount.delta), payload.postsFailedCount.trend],
    ['AI cost (cents)', n(payload.aiCostCents.current), n(payload.aiCostCents.previous), n(payload.aiCostCents.delta), payload.aiCostCents.trend],
    ['AI generations', n(payload.aiGenerationsCount.current), n(payload.aiGenerationsCount.previous), n(payload.aiGenerationsCount.delta), payload.aiGenerationsCount.trend],
    ['Crisis pending', String(payload.crisisRecsPending), '', '', ''],
    ['Crisis accepted ratio', payload.crisisAcceptedRatio !== null ? String(Math.round(payload.crisisAcceptedRatio * 100) / 100) : '', '', '', ''],
  ];
  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const sizeBytes = Buffer.byteLength(csv, 'utf8');
  const filename = `blacknel-reports-${section}-${period}-${now.toISOString().slice(0, 10)}.csv`;
  const rowCount = rows.length - 1; // exclude header

  // Audit (Ajuste 3). Emits even on success — production needs
  // the "who exported what" trail.
  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'reports.csv.exported',
        entityType: 'report',
        entityId: null,
        after: {
          section,
          period,
          brandId,
          rowCount,
          sizeBytes,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit reports.csv.exported.',
      { cause, meta: { section, period } },
    );
  }

  return ok({ csv, filename, rowCount, sizeBytes });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function n(v: number | null): string {
  if (v === null) return '';
  return String(Math.round(v * 100) / 100);
}

/**
 * RFC-4180-ish CSV escape: wrap in quotes when the value
 * contains comma, quote, or newline; double inner quotes.
 */
function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// Touch the unused parser export so future commits that add
// more sections don't need to re-import the helper.
void parseReportFilters;
