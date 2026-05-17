'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { loadAdsReport } from '@/lib/reports/ads-queries';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * CSV export for the Ads tab (Phase 8 / Commit 29, D-29-2).
 *
 * Separate action from `exportOverviewCsvAction` (D-29-2:
 * "action separado por audit cleanliness"). The audit row
 * carries `section: 'ads'` plus the period + brand scope.
 *
 * Same gating + audit shape as the Overview export. CSV body
 * encoded inline (no S3) — fine until exports grow past ~MB.
 */

const inputSchema = z.object({
  section: z.literal('ads'),
  period: z.enum(['7d', '30d', '90d']),
  brandId: z.string().uuid().nullable().optional(),
});

export interface AdsExportCsvSuccess {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly sizeBytes: number;
}

export async function exportAdsCsvAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<AdsExportCsvSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'reports:export');
  authorize(session.role, 'ads:read');

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Parámetros de export inválidos.');
  }
  const { section, period } = parsed.data;
  const brandId = parsed.data.brandId ?? null;

  const now = new Date();
  const payload = await loadAdsReport({
    orgId: session.orgId,
    userId: session.userId,
    period,
    brandId,
    now,
  });

  const rows: ReadonlyArray<string[]> = [
    ['Metric', 'Current', 'Previous', 'Delta', 'Trend'],
    [
      'Spend (USD cents)',
      n(payload.spendUsdCents.current),
      n(payload.spendUsdCents.previous),
      n(payload.spendUsdCents.delta),
      payload.spendUsdCents.trend,
    ],
    [
      'Impressions',
      n(payload.impressions.current),
      n(payload.impressions.previous),
      n(payload.impressions.delta),
      payload.impressions.trend,
    ],
    [
      'Clicks',
      n(payload.clicks.current),
      n(payload.clicks.previous),
      n(payload.clicks.delta),
      payload.clicks.trend,
    ],
    [
      'CTR (%)',
      n(payload.ctr.current),
      n(payload.ctr.previous),
      n(payload.ctr.delta),
      payload.ctr.trend,
    ],
    ['Accounts connected', String(payload.accountsConnected), '', '', ''],
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const sizeBytes = Buffer.byteLength(csv, 'utf8');
  const filename = `blacknel-reports-ads-${period}-${now.toISOString().slice(0, 10)}.csv`;
  const rowCount = rows.length - 1;

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
      'Failed to audit reports.csv.exported (ads).',
      { cause, meta: { section, period } },
    );
  }

  return ok({ csv, filename, rowCount, sizeBytes });
}

function n(v: number | null): string {
  if (v === null) return '';
  return String(Math.round(v * 100) / 100);
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
