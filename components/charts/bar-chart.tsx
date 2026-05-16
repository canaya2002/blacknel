'use client';

import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  DEFAULT_CHART_THEME,
  type ChartDataPoint,
  type ChartTheme,
} from './types';

interface BarChartProps {
  data: ReadonlyArray<ChartDataPoint>;
  /** Height in CSS px. Width is always 100% of the container. */
  height?: number;
  theme?: ChartTheme;
  /** Format the value shown in the tooltip + axis. */
  formatValue?: (value: number) => string;
  /** Optional aria-label for the SVG element. */
  ariaLabel?: string;
}

/**
 * Blacknel-themed bar chart wrapper around recharts' `BarChart`.
 *
 * Public contract: a `ChartDataPoint[]`. Theme is applied here once;
 * white-label org themes (Phase 12) override via the `theme` prop
 * without any domain code touching recharts directly.
 *
 * Color resolution per bar:
 *
 *   1. If the point has an explicit `color`, that wins.
 *   2. Otherwise the point's index modulo `theme.palette.length`
 *      picks from the palette. That covers e.g. star-distribution
 *      bars where each rating gets its own tone.
 */
export function BarChart({
  data,
  height = 240,
  theme = DEFAULT_CHART_THEME,
  formatValue,
  ariaLabel,
}: BarChartProps): React.ReactElement {
  const fmt = formatValue ?? ((v: number) => String(v));
  return (
    <div
      className="w-full"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RechartsBarChart
          data={data as Array<ChartDataPoint>}
          margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={theme.axis}
            strokeOpacity={0.2}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: theme.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: theme.axis, strokeOpacity: 0.3 }}
          />
          <YAxis
            tick={{ fill: theme.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmt(v)}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ fill: theme.muted, fillOpacity: 0.1 }}
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
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((point, idx) => (
              <Cell
                key={`${point.label}-${idx}`}
                fill={
                  point.color ?? theme.palette[idx % theme.palette.length] ?? theme.primary
                }
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
