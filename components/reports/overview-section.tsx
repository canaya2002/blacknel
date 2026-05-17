import { ReportKpiCard } from './report-kpi-card';
import { ReportExportButton } from './report-export-button';
import type { SectionPayload } from '@/lib/reports/queries';
import type { ReportPeriod } from '@/lib/reports/period';

interface OverviewSectionProps {
  payload: SectionPayload;
  period: ReportPeriod;
  brandId: string | null;
  canExport: boolean;
}

const USD_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Overview tab — cross-area KPIs muted (response time, rating,
 * volume, posts, AI cost, crisis pending). Each card uses the
 * `<ReportKpiCard />` with current + previous + delta + trend
 * (Ajuste 1).
 */
export function OverviewSection({
  payload,
  period,
  brandId,
  canExport,
}: OverviewSectionProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Overview</h2>
        {canExport ? (
          <ReportExportButton period={period} brandId={brandId} />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <ReportKpiCard
          label="Response time avg"
          value={formatDuration(payload.responseTimeAvgMs.current)}
          delta={payload.responseTimeAvgMs}
          goodDirection="down"
          formatDelta={(d) => formatDurationDelta(d)}
          formatPrevious={(p) => formatDuration(p)}
        />
        <ReportKpiCard
          label="Inbox threads"
          value={formatCount(payload.inboxThreadCount.current)}
          delta={payload.inboxThreadCount}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Rating promedio"
          value={
            payload.reviewsAvg.current === null
              ? '—'
              : `${payload.reviewsAvg.current.toFixed(2)} ★`
          }
          delta={payload.reviewsAvg}
          goodDirection="up"
          formatDelta={(d) => `${d > 0 ? '+' : ''}${d.toFixed(2)} ★`}
          formatPrevious={(p) => `${p.toFixed(2)} ★`}
        />
        <ReportKpiCard
          label="Reseñas volumen"
          value={formatCount(payload.reviewsCount.current)}
          delta={payload.reviewsCount}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />

        <ReportKpiCard
          label="Tasa de respuesta a reseñas"
          value={
            payload.reviewsResponseRate.current === null
              ? '—'
              : `${Math.round(payload.reviewsResponseRate.current)}%`
          }
          delta={payload.reviewsResponseRate}
          goodDirection="up"
          formatDelta={(d) =>
            `${d > 0 ? '+' : ''}${Math.round(d)}pp`
          }
          formatPrevious={(p) => `${Math.round(p)}%`}
        />
        <ReportKpiCard
          label="Posts publicados"
          value={formatCount(payload.postsPublishedCount.current)}
          delta={payload.postsPublishedCount}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Posts fallidos"
          value={formatCount(payload.postsFailedCount.current)}
          delta={payload.postsFailedCount}
          goodDirection="down"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Costo IA"
          value={
            payload.aiCostCents.current === null
              ? '—'
              : USD_FMT.format(payload.aiCostCents.current / 100)
          }
          delta={payload.aiCostCents}
          goodDirection="down"
          formatDelta={(d) => `${d > 0 ? '+' : ''}${USD_FMT.format(d / 100)}`}
          formatPrevious={(p) => USD_FMT.format(p / 100)}
          caption={`${formatCount(payload.aiGenerationsCount.current)} generations`}
        />
      </div>

      <div className="rounded-lg border bg-card/30 p-4">
        <h3 className="text-sm font-medium">Crisis</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {payload.crisisRecsPending > 0
            ? `${payload.crisisRecsPending} alerta${payload.crisisRecsPending === 1 ? '' : 's'} pendiente${payload.crisisRecsPending === 1 ? '' : 's'} en /reputation.`
            : 'Sin alertas pendientes.'}
          {payload.crisisAcceptedRatio !== null
            ? ` En el período, ${Math.round(payload.crisisAcceptedRatio * 100)}% de las alertas decididas fueron aceptadas.`
            : ''}
        </p>
      </div>
    </div>
  );
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

function formatDurationDelta(deltaMs: number): string {
  const sign = deltaMs > 0 ? '+' : '';
  const abs = Math.abs(deltaMs);
  const seconds = Math.round(abs / 1000);
  if (seconds < 60) return `${sign}${Math.round(deltaMs / 1000)}s`;
  if (seconds < 3600) return `${sign}${Math.round(deltaMs / 60_000)}m`;
  return `${sign}${Math.round(deltaMs / 3_600_000)}h`;
}

function formatCount(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString('en-US');
}

function signedCount(n: number): string {
  if (n > 0) return `+${n.toLocaleString('en-US')}`;
  return n.toLocaleString('en-US');
}
