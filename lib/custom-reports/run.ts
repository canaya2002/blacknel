import 'server-only';

import { type AnyPgTx, dbAs } from '@/lib/db/client';

import { withReportsCache } from '@/lib/reports/cache';

import { getCustomReportWithWidgetsWithTx } from './queries';
import type {
  WidgetRenderedPayload,
} from './types';
import { renderDistributionChart } from './widget-renderers/distribution-chart';
import { renderKpiCard } from './widget-renderers/kpi-card';
import { renderSparkline } from './widget-renderers/sparkline';
import { renderTable } from './widget-renderers/table';
import { renderTextBlock } from './widget-renderers/text-block';

/**
 * Phase 10 / Commit 39 — `runCustomReport` orchestrator.
 *
 * Loads the report + widgets, then dispatches each widget to its
 * renderer and returns a composite payload the UI can paint without
 * additional round-trips. Cached via `withReportsCache` (D-39-3 b)
 * with 60s TTL — same cache infra C27 uses for the standard
 * reports tabs. Bypass via the `?fresh=1` query param surfaces all
 * the way down here.
 *
 * # Per-widget error isolation
 *
 * If a widget's data source throws (e.g. config references a
 * non-existent metric), the orchestrator captures the error,
 * substitutes an `error` payload entry, and continues. A broken
 * widget shouldn't take the whole report down. The UI renders
 * the failure in-card.
 */

export interface RunCustomReportOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly reportId: string;
  readonly rangeStart: Date;
  readonly rangeEnd: Date;
  readonly bypassCache?: boolean;
}

export interface RenderedWidget {
  readonly widgetId: string;
  readonly kind: WidgetRenderedPayload['kind'];
  readonly positionRow: number;
  readonly positionCol: number;
  readonly width: number;
  readonly height: number;
  readonly payload?: WidgetRenderedPayload['payload'];
  readonly error?: string;
}

export interface RunCustomReportResult {
  readonly reportId: string;
  readonly name: string;
  readonly status: string;
  readonly widgets: ReadonlyArray<RenderedWidget>;
}

export async function runCustomReportWithTx(
  tx: AnyPgTx,
  opts: Omit<RunCustomReportOpts, 'bypassCache'>,
): Promise<RunCustomReportResult> {
  const loaded = await getCustomReportWithWidgetsWithTx(tx, {
    orgId: opts.orgId,
    reportId: opts.reportId,
  });
  if (!loaded) {
    throw new Error(`Custom report '${opts.reportId}' not found`);
  }

  const ctx = {
    tx,
    orgId: opts.orgId,
    userId: opts.userId,
    rangeStart: opts.rangeStart,
    rangeEnd: opts.rangeEnd,
    brandId: loaded.report.brandId,
  };

  const rendered: RenderedWidget[] = [];
  for (const w of loaded.widgets) {
    try {
      let payload: WidgetRenderedPayload['payload'];
      switch (w.kind) {
        case 'kpi_card':
          payload = await renderKpiCard(w.config, ctx);
          break;
        case 'table':
          payload = await renderTable(w.config, ctx);
          break;
        case 'sparkline':
          payload = await renderSparkline(w.config, ctx);
          break;
        case 'distribution_chart':
          payload = await renderDistributionChart(w.config, ctx);
          break;
        case 'text_block':
          payload = renderTextBlock(w.config);
          break;
      }
      rendered.push({
        widgetId: w.id,
        kind: w.kind,
        positionRow: w.positionRow,
        positionCol: w.positionCol,
        width: w.width,
        height: w.height,
        payload,
      });
    } catch (e) {
      rendered.push({
        widgetId: w.id,
        kind: w.kind,
        positionRow: w.positionRow,
        positionCol: w.positionCol,
        width: w.width,
        height: w.height,
        error: (e as Error).message,
      });
    }
  }

  return {
    reportId: loaded.report.id,
    name: loaded.report.name,
    status: loaded.report.status,
    widgets: rendered,
  };
}

export async function runCustomReport(
  opts: RunCustomReportOpts,
): Promise<RunCustomReportResult> {
  return withReportsCache(
    {
      orgId: opts.orgId,
      section: `custom_report:${opts.reportId}`,
      period: `${opts.rangeStart.toISOString().slice(0, 10)}_${opts.rangeEnd
        .toISOString()
        .slice(0, 10)}`,
      brandId: null,
    },
    opts.bypassCache === true,
    async () =>
      dbAs({ orgId: opts.orgId, userId: opts.userId }, async (tx) =>
        runCustomReportWithTx(tx, opts),
      ),
  );
}
