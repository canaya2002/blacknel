/**
 * Shared chart types. Lives in the wrapper layer so domain components
 * (e.g. /reputation charts) never import from `recharts` directly.
 *
 * If recharts ever changes its API or we swap to another library, only
 * the wrappers under `components/charts/` need to change — the domain
 * surface keeps consuming `ChartDataPoint[]` and friends.
 */

/**
 * Generic data shape consumed by all chart wrappers. `label` is the
 * x-axis category (or pie slice label); `value` is the y-axis number
 * (or slice magnitude); `meta` carries optional tone / colors / extras
 * that the wrappers know how to map onto recharts props.
 */
export interface ChartDataPoint {
  readonly label: string;
  readonly value: number;
  /** Optional explicit color override for this single point. */
  readonly color?: string;
  /** Optional secondary numeric (e.g., a delta or count) for tooltip. */
  readonly secondaryValue?: number;
  /** Optional category to drive a stacked / grouped layout. */
  readonly group?: string;
}

/**
 * Multi-series datum for line charts. `x` is the category (usually a
 * date or week label); the rest of the keys are series values keyed
 * by series name. Wrappers handle the recharts-specific mapping.
 */
export type SeriesDataPoint = { readonly x: string } & Readonly<
  Record<string, string | number | null>
>;

export interface SeriesDefinition {
  readonly key: string;
  readonly label: string;
  /** Optional color override. Falls back to the wrapper's palette. */
  readonly color?: string;
}

/**
 * Theme tokens chart wrappers consume. The defaults come from
 * Blacknel's `--color-brand-*` CSS variables surfaced by Tailwind v4
 * `@theme` — but Enterprise white-label (Phase 12) will let an org
 * override these per-render.
 */
export interface ChartTheme {
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly muted: string;
  /** Pie / bar slice colors used in rotation when each datum has no `color`. */
  readonly palette: ReadonlyArray<string>;
  /** Axis / gridline / label tone. */
  readonly axis: string;
  /** Tooltip background + border. */
  readonly tooltipBg: string;
  readonly tooltipFg: string;
  readonly tooltipBorder: string;
}

/**
 * Default Blacknel chart theme. Uses Tailwind / `@theme` semantic
 * tokens via inlined hex equivalents — recharts cannot resolve CSS
 * vars at SVG render time without an extra ref-measurement hop. We
 * pick neutral zinc-derived defaults so the charts stay calm and
 * read well in dark mode without recomputing.
 */
export const DEFAULT_CHART_THEME: ChartTheme = {
  primary: '#3f4753', // brand accent (steel grey) — matches globals.css
  secondary: '#71717a', // zinc-500
  accent: '#f59e0b', // amber-500 — same as stars in row UI
  muted: '#a1a1aa', // zinc-400
  palette: [
    '#3f4753', // primary
    '#10b981', // emerald — positive
    '#f59e0b', // amber — warning / neutral
    '#ef4444', // red — negative
    '#6366f1', // indigo — accent
    '#a1a1aa', // zinc — unknown
  ],
  axis: '#a1a1aa',
  tooltipBg: '#18181b', // zinc-900 — works in both modes via opacity
  tooltipFg: '#fafafa',
  tooltipBorder: '#3f3f46',
};
