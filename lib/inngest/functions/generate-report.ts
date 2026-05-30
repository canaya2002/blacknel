import {
  generateAndDeliverReport,
  type ReportPillar,
} from '@/lib/reports/pdf/generate-report';

import type { BlacknelEvents } from '../client';
import { inngest } from '../client';

/**
 * Event job: render → store → email a white-label PDF report (C52). Triggered by
 * `report.generate` (on-demand action or the scheduled-reports cron). Logic lives
 * in generateAndDeliverReport (unit-testable without the Inngest harness).
 */
export const generateReportFn = inngest.createFunction(
  { id: 'generate-report', triggers: [{ event: 'report.generate' }] },
  async ({ event, step }) => {
    const data = event.data as BlacknelEvents['report.generate']['data'];
    return step.run('generate', () =>
      generateAndDeliverReport({
        orgId: data.orgId,
        periodDays: data.periodDays,
        pillars: data.pillars as ReportPillar[],
        recipients: data.recipients,
      }),
    );
  },
);
