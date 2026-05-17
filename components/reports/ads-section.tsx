import { ReportKpiCard } from './report-kpi-card';
import { AdsExportButton } from './ads-export-button';
import type { AdsReportPayload } from '@/lib/reports/ads-queries';
import type { ReportPeriod } from '@/lib/reports/period';

interface AdsSectionProps {
  payload: AdsReportPayload;
  period: ReportPeriod;
  brandId: string | null;
  canExport: boolean;
}

const USD_FMT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Ads tab — 4 KPIs (spend / impressions / clicks / CTR) with
 * delta vs previous period. Phase 8 / Commit 29.
 *
 * Reuses `<ReportKpiCard />` from Commit 27 (same trend +
 * tone semantics) — only the formatters change. Spend is
 * USD-frozen so cross-currency accounts roll up correctly;
 * see `lib/ads/fx-rates.ts` for the freeze rationale.
 */
export function AdsSection({
  payload,
  period,
  brandId,
  canExport,
}: AdsSectionProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ads</h2>
        {canExport ? (
          <AdsExportButton period={period} brandId={brandId} />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <ReportKpiCard
          label="Spend (USD)"
          value={
            payload.spendUsdCents.current === null
              ? '—'
              : USD_FMT.format(payload.spendUsdCents.current / 100)
          }
          delta={payload.spendUsdCents}
          goodDirection="down"
          formatDelta={(d) =>
            `${d > 0 ? '+' : ''}${USD_FMT.format(d / 100)}`
          }
          formatPrevious={(p) => USD_FMT.format(p / 100)}
          caption={`${payload.accountsConnected} cuenta${payload.accountsConnected === 1 ? '' : 's'} conectada${payload.accountsConnected === 1 ? '' : 's'}`}
        />
        <ReportKpiCard
          label="Impressions"
          value={formatCount(payload.impressions.current)}
          delta={payload.impressions}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="Clicks"
          value={formatCount(payload.clicks.current)}
          delta={payload.clicks}
          goodDirection="up"
          formatDelta={(d) => signedCount(d)}
          formatPrevious={(p) => formatCount(p)}
        />
        <ReportKpiCard
          label="CTR"
          value={
            payload.ctr.current === null
              ? '—'
              : `${payload.ctr.current.toFixed(2)}%`
          }
          delta={payload.ctr}
          goodDirection="up"
          formatDelta={(d) => `${d > 0 ? '+' : ''}${d.toFixed(2)}pp`}
          formatPrevious={(p) => `${p.toFixed(2)}%`}
        />
      </div>

      {payload.accountsConnected === 0 ? (
        <p className="rounded-md border bg-card/30 px-4 py-3 text-xs text-muted-foreground">
          No tenés cuentas de ads conectadas. Conectá Google Ads o Meta Ads en /ads
          para empezar a ver métricas en este reporte.
        </p>
      ) : null}
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
