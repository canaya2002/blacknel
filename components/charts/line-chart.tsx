'use client';

import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  DEFAULT_CHART_THEME,
  type ChartTheme,
  type SeriesDataPoint,
  type SeriesDefinition,
} from './types';

interface LineChartProps {
  data: ReadonlyArray<SeriesDataPoint>;
  series: ReadonlyArray<SeriesDefinition>;
  /** Height in CSS px. Width is always 100% of the container. */
  height?: number;
  theme?: ChartTheme;
  formatValue?: (value: number) => string;
  /** When true, the y-axis floor pins at 0. Defaults to true. */
  yAxisFromZero?: boolean;
  /** Optional y-axis ceiling override (e.g. rating tops at 5). */
  yAxisMax?: number;
  ariaLabel?: string;
}

/**
 * Blacknel-themed line chart wrapper around recharts' `LineChart`.
 * Supports N series; each is a separate `<Line>` keyed by
 * `series[i].key` against the `x` column of the data points.
 *
 * Use case in Phase 5: rating-over-time trend on /reputation.
 * Phase 8 (Reports) layers SLA and response-time series on top of
 * the same wrapper.
 */
export function LineChart({
  data,
  series,
  height = 240,
  theme = DEFAULT_CHART_THEME,
  formatValue,
  yAxisFromZero = true,
  yAxisMax,
  ariaLabel,
}: LineChartProps): React.ReactElement {
  const fmt = formatValue ?? ((v: number) => String(v));
  const domain: [number | 'auto', number | 'auto'] = [
    yAxisFromZero ? 0 : 'auto',
    yAxisMax ?? 'auto',
  ];
  return (
    <div className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart
          data={data as Array<SeriesDataPoint>}
          margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={theme.axis}
            strokeOpacity={0.2}
            vertical={false}
          />
          <XAxis
            dataKey="x"
            tick={{ fill: theme.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: theme.axis, strokeOpacity: 0.3 }}
          />
          <YAxis
            domain={domain}
            tick={{ fill: theme.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmt(v)}
            allowDecimals
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: 6,
              fontSize: 12,
              color: theme.tooltipFg,
              padding: '6px 10px',
            }}
            labelStyle={{ color: theme.tooltipFg, fontWeight: 600 }}
            formatter={(value: unknown) =>
              typeof value === 'number' ? [fmt(value), ''] : [String(value), '']
            }
          />
          {series.map((s, idx) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? theme.palette[idx % theme.palette.length] ?? theme.primary}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
