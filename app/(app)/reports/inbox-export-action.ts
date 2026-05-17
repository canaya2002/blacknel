'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin } from '@/lib/db/client';
import { auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { loadInboxReport } from '@/lib/reports/inbox-queries';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Inbox tab CSV export (Phase 8 / Commit 30).
 *
 * Separate action from Overview / Ads — same audit cleanliness
 * rationale as D-29-2. Audit row carries `section: 'inbox'`.
 */

const inputSchema = z.object({
  section: z.literal('inbox'),
  period: z.enum(['7d', '30d', '90d']),
  brandId: z.string().uuid().nullable().optional(),
});

export interface InboxExportCsvSuccess {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly sizeBytes: number;
}

export async function exportInboxCsvAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<InboxExportCsvSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'reports:export');

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Parámetros de export inválidos.');
  }
  const { section, period } = parsed.data;
  const brandId = parsed.data.brandId ?? null;

  const now = new Date();
  const payload = await loadInboxReport({
    orgId: session.orgId,
    userId: session.userId,
    period,
    brandId,
    now,
  });

  const rows: ReadonlyArray<string[]> = [
    ['Metric', 'Current', 'Previous', 'Delta', 'Trend'],
    [
      'Response time p50 (ms)',
      n(payload.responseTimeP50Ms.current),
      n(payload.responseTimeP50Ms.previous),
      n(payload.responseTimeP50Ms.delta),
      payload.responseTimeP50Ms.trend,
    ],
    [
      'Threads opened',
      n(payload.threadsOpened.current),
      n(payload.threadsOpened.previous),
      n(payload.threadsOpened.delta),
      payload.threadsOpened.trend,
    ],
    [
      'Threads closed',
      n(payload.threadsClosed.current),
      n(payload.threadsClosed.previous),
      n(payload.threadsClosed.delta),
      payload.threadsClosed.trend,
    ],
    [
      'AI-assisted reply ratio (%)',
      n(payload.aiAssistedReplyRatio.current),
      n(payload.aiAssistedReplyRatio.previous),
      n(payload.aiAssistedReplyRatio.delta),
      payload.aiAssistedReplyRatio.trend,
    ],
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const sizeBytes = Buffer.byteLength(csv, 'utf8');
  const filename = `blacknel-reports-inbox-${period}-${now.toISOString().slice(0, 10)}.csv`;
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
      'Failed to audit reports.csv.exported (inbox).',
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
