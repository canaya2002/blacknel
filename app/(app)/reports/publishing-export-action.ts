'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { loadPublishingReport } from '@/lib/reports/publishing-queries';
import { err, ok, type Result } from '@/lib/types/result';

const inputSchema = z.object({
  section: z.literal('publishing'),
  period: z.enum(['7d', '30d', '90d']),
  brandId: z.string().uuid().nullable().optional(),
});

export interface PublishingExportCsvSuccess {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly sizeBytes: number;
}

export async function exportPublishingCsvAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<PublishingExportCsvSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'reports:export');

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Parámetros de export inválidos.');
  }
  const { section, period } = parsed.data;
  const brandId = parsed.data.brandId ?? null;

  const now = new Date();
  const payload = await loadPublishingReport({
    orgId: session.orgId,
    userId: session.userId,
    period,
    brandId,
    now,
  });

  const rows: ReadonlyArray<string[]> = [
    ['Metric', 'Current', 'Previous', 'Delta', 'Trend'],
    [
      'Posts published',
      n(payload.postsPublished.current),
      n(payload.postsPublished.previous),
      n(payload.postsPublished.delta),
      payload.postsPublished.trend,
    ],
    [
      'Posts failed',
      n(payload.postsFailed.current),
      n(payload.postsFailed.previous),
      n(payload.postsFailed.delta),
      payload.postsFailed.trend,
    ],
    [
      'Target success rate (%)',
      n(payload.targetSuccessRate.current),
      n(payload.targetSuccessRate.previous),
      n(payload.targetSuccessRate.delta),
      payload.targetSuccessRate.trend,
    ],
    [
      'Targets with retry',
      n(payload.targetsWithRetry.current),
      n(payload.targetsWithRetry.previous),
      n(payload.targetsWithRetry.delta),
      payload.targetsWithRetry.trend,
    ],
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const sizeBytes = Buffer.byteLength(csv, 'utf8');
  const filename = `blacknel-reports-publishing-${period}-${now.toISOString().slice(0, 10)}.csv`;
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
      'Failed to audit reports.csv.exported (publishing).',
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
