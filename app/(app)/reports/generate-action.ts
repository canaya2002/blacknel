'use server';

import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { tryEmit } from '@/lib/inngest/client';
import { authorize } from '@/lib/permissions/can';
import { generateAndDeliverReport } from '@/lib/reports/pdf/generate-report';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * On-demand white-label report generation (C52). Validates + gates on
 * `reports:create`, then emits `report.generate` (durable Inngest job) or runs it
 * inline when Inngest is off. The job renders → stores → emails under the org's
 * RLS + branding; this action never touches another org's data.
 */

const schema = z.object({
  periodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]),
  pillars: z.array(z.enum(['publishing', 'reviews', 'ads', 'inbox'])).min(1),
  recipients: z.array(z.string().email()).min(1).max(20),
});

export async function generateReportNowAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ queued: boolean }>> {
  const session = await requireUser();
  authorize(session.role, 'reports:create');

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Solicitud de reporte inválida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }

  const payload = { orgId: session.orgId, ...parsed.data };
  const emitted = await tryEmit('report.generate', payload);
  if (!emitted) await generateAndDeliverReport(payload);
  return ok({ queued: emitted });
}
