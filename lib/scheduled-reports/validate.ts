import { z } from 'zod';

/**
 * Scheduled-report config validation (Phase 9 / Commit 34).
 *
 * `scheduleExpr` shapes by `kind`:
 *
 *   - weekly  → `"<dow> HH:MM"` where dow ∈ {sun, mon, tue, wed,
 *                thu, fri, sat}. Example: `"mon 09:00"`.
 *   - monthly → `"<day-of-month> HH:MM"` where day ∈ 1..28
 *                (28 cap so we never skip Feb). Example: `"1 09:00"`.
 *   - custom  → 5-field cron. Phase-9 mock parser accepts the
 *                same shape as the weekly/monthly above for
 *                compatibility; a full cron parser lands with
 *                the Phase-11 Inngest cutover.
 */

const KIND = z.enum(['weekly', 'monthly', 'custom']);

const WEEKLY_RE = /^(sun|mon|tue|wed|thu|fri|sat)\s+([01]\d|2[0-3]):([0-5]\d)$/i;
const MONTHLY_RE = /^([1-9]|1\d|2[0-8])\s+([01]\d|2[0-3]):([0-5]\d)$/;

export const createScheduledReportSchema = z
  .object({
    brandId: z.string().uuid().nullable().optional(),
    name: z.string().min(1).max(120),
    kind: KIND,
    scheduleExpr: z.string().min(3).max(120),
    recipients: z.array(z.string().email()).min(1).max(20),
  })
  .superRefine((val, ctx) => {
    if (val.kind === 'weekly' && !WEEKLY_RE.test(val.scheduleExpr)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleExpr'],
        message:
          'Formato weekly inválido. Esperado "<dow> HH:MM", ej "mon 09:00".',
      });
    }
    if (val.kind === 'monthly' && !MONTHLY_RE.test(val.scheduleExpr)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleExpr'],
        message:
          'Formato monthly inválido. Esperado "<1-28> HH:MM", ej "1 09:00".',
      });
    }
    // `custom` accepts both formats for Phase 9 (the cron tick
    // treats them identically — the real cron parser lands Phase 11).
    if (
      val.kind === 'custom' &&
      !WEEKLY_RE.test(val.scheduleExpr) &&
      !MONTHLY_RE.test(val.scheduleExpr)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleExpr'],
        message:
          'Formato custom debe coincidir weekly o monthly por ahora (cron-5 completo en Fase 11).',
      });
    }
  });

export type CreateScheduledReportInput = z.infer<
  typeof createScheduledReportSchema
>;

export const pauseScheduledReportSchema = z.object({
  scheduledReportId: z.string().uuid(),
  paused: z.boolean(),
});

export const runScheduledReportNowSchema = z.object({
  scheduledReportId: z.string().uuid(),
});
