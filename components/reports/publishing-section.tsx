import { ReportKpiCard } from './report-kpi-card';
import { PublishingExportButton } from './publishing-export-button';
import type { PublishingReportPayload } from '@/lib/reports/publishing-queries';
import type { ReportPeriod } from '@/lib/reports/period';

interface PublishingSectionProps {
  payload: PublishingReportPayload;
  period: ReportPeriod;
  brandId: string | null;
  canExport: boolean;
}

/**
 * Publishing tab — 4 KPIs (posts published, posts failed, target
 * success rate, targets with retry). Phase 8 / Commit 30.
 *
 * `posts.brand_id` is honored — the brand filter narrows the
 * cohort consistently with Overview's posts metrics.
 */
export function PublishingSection({
  payload,
  period,
  brandId,
  canExport,
}: PublishingSectionProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Publishing</h2>
        {canExport ? (
          <PublishingExportButton period={period} brandId={brandId} />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <ReportKpiCard
          label="Posts publicados"
          value={formatCount(payload.postsPublished.current)}
          delta={payload.postsPublished}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Posts fallidos"
          value={formatCount(payload.postsFailed.current)}
          delta={payload.postsFailed}
          goodDirection="down"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Tasa de éxito por target"
          value={
            payload.targetSuccessRate.current === null
              ? '—'
              : `${payload.targetSuccessRate.current.toFixed(1)}%`
          }
          delta={payload.targetSuccessRate}
          goodDirection="up"
          formatDelta={(d) => `${d > 0 ? '+' : ''}${d.toFixed(1)}pp`}
          formatPrevious={(p) => `${p.toFixed(1)}%`}
        />
        <ReportKpiCard
          label="Targets que requirieron retry"
          value={formatCount(payload.targetsWithRetry.current)}
          delta={payload.targetsWithRetry}
          goodDirection="down"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
      </div>
    </div>
  );
}

function formatCount(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString('en-US');
}

function signedCount(n: number): string {
  if (n > 0) return `+${n.toLocaleString('en-US')}`;
  return n.toLocaleString('en-US');
}
