import { ReportKpiCard } from './report-kpi-card';
import { InboxExportButton } from './inbox-export-button';
import type { InboxReportPayload } from '@/lib/reports/inbox-queries';
import type { ReportPeriod } from '@/lib/reports/period';

interface InboxSectionProps {
  payload: InboxReportPayload;
  period: ReportPeriod;
  brandId: string | null;
  canExport: boolean;
}

/**
 * Inbox tab — 4 KPIs (p50 response time, threads opened/closed,
 * AI-assisted reply ratio). Phase 8 / Commit 30.
 *
 * Inbox tables don't carry `brand_id` today, so the brand filter
 * is a no-op for this section (queries skip the brand condition).
 */
export function InboxSection({
  payload,
  period,
  brandId,
  canExport,
}: InboxSectionProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Inbox</h2>
        {canExport ? (
          <InboxExportButton period={period} brandId={brandId} />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <ReportKpiCard
          label="Response time p50"
          value={formatDuration(payload.responseTimeP50Ms.current)}
          delta={payload.responseTimeP50Ms}
          goodDirection="down"
          formatDelta={(d) => formatDurationDelta(d)}
          formatPrevious={(p) => formatDuration(p)}
        />
        <ReportKpiCard
          label="Threads abiertos"
          value={formatCount(payload.threadsOpened.current)}
          delta={payload.threadsOpened}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Threads cerrados"
          value={formatCount(payload.threadsClosed.current)}
          delta={payload.threadsClosed}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Reply mix asistido por IA"
          value={
            payload.aiAssistedReplyRatio.current === null
              ? '—'
              : `${payload.aiAssistedReplyRatio.current.toFixed(1)}%`
          }
          delta={payload.aiAssistedReplyRatio}
          goodDirection="up"
          formatDelta={(d) => `${d > 0 ? '+' : ''}${d.toFixed(1)}pp`}
          formatPrevious={(p) => `${p.toFixed(1)}%`}
        />
      </div>

      <p className="rounded-md border bg-card/30 px-4 py-2 text-xs text-muted-foreground">
        Inbox tables no carry brand_id por tenant — el filtro de marca arriba
        no afecta este tab.
      </p>
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
