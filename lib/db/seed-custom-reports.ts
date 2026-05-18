import 'server-only';

import { createHash } from 'node:crypto';

import { customReportWidgets, customReports } from './schema';
import { SEED_IDS } from './seed';

import {
  TEMPLATES,
  type CustomReportTemplate,
  type TemplateId,
} from '../custom-reports/templates';

import type { AnyPgTx } from './client';

/**
 * Phase 10 / Commit 39 — Custom Reports demo seed.
 *
 * Inserts 2 published custom reports on the demo org:
 *
 *   1. "Marketing Overview" — uses the marketing_performance template.
 *   2. "Operations Dashboard" — uses the customer_service_overview template.
 *
 * The demo org runs on Growth so the rows are **hidden** behind the
 * `<UpgradePrompt>` on `/reports/custom` until the org is bumped to
 * Enterprise for a screenshare. Same precedent as Phase-5 yelp seed
 * and C38 enterprise networks seed: data exists end-to-end so plan
 * gating itself can be tested.
 *
 * Deterministic UUIDs derived from `(template id + slot)` so re-runs
 * resolve via ON CONFLICT.
 */

const ORG = SEED_IDS.org.demo;
const CREATED_AT = new Date('2026-05-10T12:00:00Z');

function uuidFromSeed(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    '8' + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

interface SeedReport {
  readonly templateId: TemplateId;
  readonly name: string;
  readonly description: string;
}

const SEED_REPORTS: ReadonlyArray<SeedReport> = [
  {
    templateId: 'marketing_performance',
    name: 'Marketing Overview',
    description:
      'Dashboard del equipo de Marketing — reach proxied desde post_targets (Phase 10), engagement rate y review trend.',
  },
  {
    templateId: 'customer_service_overview',
    name: 'Operations Dashboard',
    description:
      'Dashboard del support manager — tiempos de respuesta, NPS, flujo de threads, approvals pendientes.',
  },
];

export async function seedCustomReports(tx: AnyPgTx): Promise<void> {
  for (const sr of SEED_REPORTS) {
    const reportId = uuidFromSeed(`custom-report|${ORG}|${sr.templateId}`);
    await tx
      .insert(customReports)
      .values({
        id: reportId,
        organizationId: ORG,
        name: sr.name,
        description: sr.description,
        status: 'published',
        createdBy: SEED_IDS.user.manager,
        shareScope: 'org_visible',
        publishedAt: CREATED_AT,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      })
      .onConflictDoNothing({ target: customReports.id });

    const template: CustomReportTemplate = TEMPLATES[sr.templateId];
    const widgetRows = template.widgets.map((w, i) => ({
      id: uuidFromSeed(`custom-report-widget|${reportId}|${i}`),
      customReportId: reportId,
      kind: w.kind,
      positionRow: w.positionRow,
      positionCol: w.positionCol,
      width: w.width,
      height: w.height,
      config: w.config as unknown as Record<string, unknown>,
      displayOrder: i,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }));
    await tx
      .insert(customReportWidgets)
      .values(widgetRows)
      .onConflictDoNothing({ target: customReportWidgets.id });
  }
}
