'use client';

import {
  Cell,
  Legend,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import {
  DEFAULT_CHART_THEME,
  type ChartDataPoint,
  type ChartTheme,
} from './types';

interface PieChartProps {
  data: ReadonlyArray<ChartDataPoint>;
  /** Height in CSS px. Width is always 100% of the container. */
  height?: number;
  theme?: ChartTheme;
  /** Show the percentage inside each slice's label. Defaults to true. */
  showLabels?: boolean;
  /** Show a horizontal legend below the chart. Defaults to true. */
  showLegend?: boolean;
  ariaLabel?: string;
}

/**
 * Blacknel-themed pie / donut chart wrapper. Same `ChartDataPoint`
 * contract as the bar chart so callers can shuffle visualisation
 * without re-shaping data.
 *
 * Phase-5 use case: sentiment breakdown on /reputation
 * (positive / neutral / negative / unknown). Slice color comes from
 * the point's explicit `color` (semantic — green/amber/red/zinc) or
 * falls back to the theme palette.
 *
 * Donut style is the default — the inner hole makes the chart less
 * dominant than a solid pie in a dashboard column.
 */
export function PieChart({
  data,
  height = 240,
  theme = DEFAULT_CHART_THEME,
  showLabels = true,
  showLegend = true,
  ariaLabel,
}: PieChartProps): React.ReactElement {
  const total = data.reduce((acc, p) => acc + p.value, 0);
  return (
    <div className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsPieChart>
          <Pie
            data={data as Array<ChartDataPoint>}
            dataKey="value"
            nameKey="label"
            innerRadius="55%"
            outerRadius="85%"
            stroke="none"
            paddingAngle={2}
            isAnimationActive={false}
            label={
              showLabels
                ? (props: { value?: number }) => {
                    if (total === 0 || typeof props.value !== 'number') return '';
                    const pct = Math.round((props.value / total) * 100);
                    return pct > 0 ? `${pct}%` : '';
                  }
                : false
            }
            labelLine={false}
          >
            {data.map((point, idx) => (
              <Cell
                key={`${point.label}-${idx}`}
                fill={
                  point.color ?? theme.palette[idx % theme.palette.length] ?? theme.primary
                }
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: 6,
              fontSize: 12,
              color: theme.tooltipFg,
              padding: '6px 10px',
            }}
            formatter={(value: unknown, name: unknown) => {
              if (typeof value !== 'number') return [String(value), String(name)];
              const pct = total === 0 ? 0 : Math.round((value / total) * 100);
              return [`${value} (${pct}%)`, String(name)];
            }}
          />
          {showLegend ? (
            <Legend
              verticalAlign="bottom"
              align="center"
              iconType="circle"
              wrapperStyle={{ fontSize: 11, color: theme.axis }}
            />
          ) : null}
        </RechartsPieChart>
      </ResponsiveContainer>
    </div>
  );
}
