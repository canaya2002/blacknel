import { AlertCircle } from 'lucide-react';

import type {
  DistributionChartPayload,
  KpiCardPayload,
  SparklinePayload,
  TablePayload,
  TextBlockPayload,
} from '@/lib/custom-reports/types';
import type { RenderedWidget } from '@/lib/custom-reports/run';

interface WidgetRendererProps {
  widget: RenderedWidget;
}

/**
 * Phase 10 / Commit 39 — polymorphic widget renderer.
 *
 * Maps each `kind` to its dedicated visual. Vanilla SVG for
 * sparkline + distribution_chart (D-39-1 a — no recharts).
 *
 * **Error path** — if the orchestrator's `error` field is populated,
 * surfaces the failure in-card with a destructive tone. The rest of
 * the report keeps rendering.
 */
export function WidgetRenderer({
  widget,
}: WidgetRendererProps): React.ReactElement {
  if (widget.error || !widget.payload) {
    return (
      <div className="flex h-full flex-col items-start gap-1 text-xs">
        <span className="flex items-center gap-1 text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          Widget no se pudo renderizar
        </span>
        <span className="text-[10px] text-muted-foreground">
          {widget.error ?? 'Sin payload'}
        </span>
      </div>
    );
  }

  switch (widget.kind) {
    case 'kpi_card':
      return <KpiCard payload={widget.payload as KpiCardPayload} />;
    case 'table':
      return <TableWidget payload={widget.payload as TablePayload} />;
    case 'sparkline':
      return <Sparkline payload={widget.payload as SparklinePayload} />;
    case 'distribution_chart':
      return (
        <DistributionChart
          payload={widget.payload as DistributionChartPayload}
        />
      );
    case 'text_block':
      return <TextBlock payload={widget.payload as TextBlockPayload} />;
  }
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

function formatScalar(
  value: number | string,
  format: KpiCardPayload['format'],
): string {
  if (typeof value === 'string') return value;
  switch (format) {
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'currency_usd':
      return `$${value.toLocaleString('en-US')}`;
    case 'duration_minutes':
      return `${Math.round(value)} min`;
    case 'duration_hours':
      return `${Math.round(value)} h`;
    case 'number':
    default:
      return value.toLocaleString('en-US');
  }
}

function KpiCard({
  payload,
}: {
  payload: KpiCardPayload;
}): React.ReactElement {
  const formatted = formatScalar(payload.value, payload.format);
  const delta = payload.delta;
  return (
    <div className="flex h-full flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {payload.label}
      </span>
      <span className="text-2xl font-semibold tabular-nums">{formatted}</span>
      {delta ? (
        <span
          className={`text-[10px] ${
            delta.absolute > 0
              ? 'text-emerald-600'
              : delta.absolute < 0
                ? 'text-red-600'
                : 'text-muted-foreground'
          }`}
        >
          {delta.absolute > 0 ? '↑' : delta.absolute < 0 ? '↓' : '·'}{' '}
          {Math.abs(delta.absolute)}
          {delta.percent !== null ? ` (${delta.percent.toFixed(1)}%)` : ''}
          {' vs período anterior'}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table widget
// ---------------------------------------------------------------------------

function TableWidget({
  payload,
}: {
  payload: TablePayload;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b">
            {payload.columns.map((c) => (
              <th
                key={c.key}
                className="px-2 py-1 text-left font-medium text-muted-foreground"
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {payload.rows.map((r, i) => (
            <tr key={i} className="border-b last:border-b-0">
              {payload.columns.map((c) => (
                <td key={c.key} className="truncate px-2 py-1">
                  {String(r[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {payload.rows.length === 0 ? (
            <tr>
              <td
                colSpan={payload.columns.length}
                className="px-2 py-4 text-center text-[10px] text-muted-foreground"
              >
                Sin datos en este período.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (vanilla SVG)
// ---------------------------------------------------------------------------

function Sparkline({
  payload,
}: {
  payload: SparklinePayload;
}): React.ReactElement {
  const W = 240;
  const H = 60;
  const PAD = 4;
  const values = payload.points.map((p) => p.v);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || 1;

  const points = payload.points
    .map((p, i) => {
      const x =
        PAD +
        (payload.points.length === 1
          ? (W - 2 * PAD) / 2
          : (i * (W - 2 * PAD)) / (payload.points.length - 1));
      const y = H - PAD - ((p.v - min) / span) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="flex h-full flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {payload.label}
      </span>
      {payload.points.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">
          Sin datos en este período.
        </span>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height="60"
          preserveAspectRatio="none"
          aria-label={payload.label}
          data-testid="sparkline-svg"
        >
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            points={points}
          />
        </svg>
      )}
      {payload.delta ? (
        <span
          className={`text-[10px] ${
            payload.delta.absolute > 0
              ? 'text-emerald-600'
              : payload.delta.absolute < 0
                ? 'text-red-600'
                : 'text-muted-foreground'
          }`}
        >
          Δ {payload.delta.absolute}
          {payload.delta.percent !== null
            ? ` (${payload.delta.percent.toFixed(1)}%)`
            : ''}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribution chart (vanilla SVG horizontal bars)
// ---------------------------------------------------------------------------

function DistributionChart({
  payload,
}: {
  payload: DistributionChartPayload;
}): React.ReactElement {
  const max = payload.buckets.length
    ? Math.max(...payload.buckets.map((b) => b.value))
    : 1;
  return (
    <div className="flex h-full flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {payload.label}
      </span>
      {payload.buckets.length === 0 ? (
        <span className="text-[10px] text-muted-foreground">
          Sin datos en este período.
        </span>
      ) : (
        <div className="flex flex-col gap-1.5" data-testid="distribution-svg">
          {payload.buckets.map((b) => {
            const pct = max === 0 ? 0 : (b.value / max) * 100;
            return (
              <div key={b.key} className="flex items-center gap-2 text-[10px]">
                <span className="w-20 truncate text-muted-foreground">
                  {b.key}
                </span>
                <div className="relative h-3 flex-1 rounded bg-muted/30">
                  <div
                    className="h-full rounded bg-primary/60"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-10 text-right tabular-nums">{b.value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text block (sanitized markdown)
// ---------------------------------------------------------------------------

function TextBlock({
  payload,
}: {
  payload: TextBlockPayload;
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col gap-2">
      {payload.heading ? (
        <h4 className="text-sm font-medium">{payload.heading}</h4>
      ) : null}
      <div
        className="prose-sm max-w-none text-xs leading-relaxed text-muted-foreground"
        // Sanitized at the source (`lib/custom-reports/widget-renderers/text-block.ts`).
        dangerouslySetInnerHTML={{ __html: payload.safeHtml }}
      />
    </div>
  );
}
