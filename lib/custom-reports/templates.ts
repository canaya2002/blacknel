import type {
  CustomReportWidgetKind,
  KpiCardConfig,
  TableConfig,
  SparklineConfig,
  DistributionChartConfig,
  TextBlockConfig,
} from './types';

/**
 * Phase 10 / Commit 39 — Ajuste 1: explicit starter templates.
 *
 * Three demo-ready templates. Each carries (a) report metadata
 * (name + description) and (b) a list of pre-positioned widgets
 * with fully-formed configs. The wizard at
 * `/reports/custom/new?template=<id>` materializes the chosen
 * template into a draft custom_report + widgets in one Server
 * Action invocation.
 *
 * # Layout invariants
 *
 *   - 12-col grid (matches `lib/custom-reports/layout-validate.ts`).
 *   - All widgets land inside the bounds: position_col + width ≤ 12.
 *   - NO overlapping widgets — validated by the
 *     `custom-reports-templates.test.ts` suite.
 *
 * # Why hard-coded
 *
 * Demos run end-to-end on day 1 without authoring overhead. The
 * 3 templates here cover the 3 buyer personas C39 targets:
 *
 *   - Marketing Performance       → CMO / marketing director.
 *   - Customer Service Overview   → support manager.
 *   - Executive Dashboard         → C-level / exec sponsor.
 */

export type TemplateId =
  | 'marketing_performance'
  | 'customer_service_overview'
  | 'executive_dashboard';

export interface TemplateWidget {
  readonly kind: CustomReportWidgetKind;
  readonly positionRow: number;
  readonly positionCol: number;
  readonly width: number;
  readonly height: number;
  readonly config:
    | KpiCardConfig
    | TableConfig
    | SparklineConfig
    | DistributionChartConfig
    | TextBlockConfig;
}

export interface CustomReportTemplate {
  readonly id: TemplateId;
  readonly name: string;
  readonly description: string;
  readonly persona: string;
  readonly widgets: ReadonlyArray<TemplateWidget>;
}

// ---------------------------------------------------------------------------
// Template 1 — Marketing Performance
// ---------------------------------------------------------------------------

const MARKETING_PERFORMANCE: CustomReportTemplate = {
  id: 'marketing_performance',
  name: 'Marketing Performance',
  description:
    'Reach, engagement y reseñas en un solo dashboard. Reach es proxied desde post_targets hasta que Phase 11 conecte los endpoints de insights reales.',
  persona: 'CMO / Marketing Director',
  widgets: [
    // Row 0 — 2 KPI cards (3 cols each) + 1 sparkline (6 cols)
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 0,
      width: 3,
      height: 1,
      config: {
        dataSource: 'posts_metrics',
        metric: 'total_reach',
        label: 'Total reach (30d)',
        compareToPrevious: true,
        format: 'number',
      } satisfies KpiCardConfig,
    },
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 3,
      width: 3,
      height: 1,
      config: {
        dataSource: 'posts_metrics',
        metric: 'engagement_rate',
        label: 'Engagement rate',
        compareToPrevious: true,
        format: 'percent',
      } satisfies KpiCardConfig,
    },
    {
      kind: 'sparkline',
      positionRow: 0,
      positionCol: 6,
      width: 6,
      height: 1,
      config: {
        dataSource: 'reviews_aggregates',
        metric: 'avg_rating',
        label: 'Avg rating · 90 días',
        rangeDays: 90,
        compareToPrevious: true,
      } satisfies SparklineConfig,
    },
    // Row 1 — distribution chart (6 cols) + table (6 cols)
    {
      kind: 'distribution_chart',
      positionRow: 1,
      positionCol: 0,
      width: 6,
      height: 2,
      config: {
        dataSource: 'listening_aggregates',
        groupBy: 'sentiment',
        label: 'Mentions by sentiment · 30d',
        rangeDays: 30,
      } satisfies DistributionChartConfig,
    },
    {
      kind: 'table',
      positionRow: 1,
      positionCol: 6,
      width: 6,
      height: 2,
      config: {
        dataSource: 'posts_metrics',
        columns: [
          { key: 'id', label: 'ID', format: 'text' },
          { key: 'text', label: 'Texto', format: 'text' },
          { key: 'published_at', label: 'Publicado', format: 'date' },
        ],
        limit: 5,
      } satisfies TableConfig,
    },
  ],
};

// ---------------------------------------------------------------------------
// Template 2 — Customer Service Overview
// ---------------------------------------------------------------------------

const CUSTOMER_SERVICE_OVERVIEW: CustomReportTemplate = {
  id: 'customer_service_overview',
  name: 'Customer Service Overview',
  description:
    'Tiempos de respuesta, NPS, flujo de threads y aprobaciones pendientes — el dashboard del support manager.',
  persona: 'Support Manager',
  widgets: [
    // Row 0 — 2 KPIs side-by-side
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 0,
      width: 4,
      height: 1,
      config: {
        dataSource: 'inbox_kpis',
        metric: 'avg_response_time_minutes',
        label: 'Average response time',
        compareToPrevious: true,
        format: 'duration_minutes',
      } satisfies KpiCardConfig,
    },
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 4,
      width: 4,
      height: 1,
      config: {
        dataSource: 'nps_aggregates',
        metric: 'nps_score',
        label: 'NPS score (30d)',
        compareToPrevious: false,
        format: 'number',
      } satisfies KpiCardConfig,
    },
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 8,
      width: 4,
      height: 1,
      config: {
        dataSource: 'inbox_kpis',
        metric: 'threads_pending_approval_count',
        label: 'Pending approvals',
        format: 'number',
      } satisfies KpiCardConfig,
    },
    // Row 1 — sparkline 6 cols + table 6 cols
    {
      kind: 'sparkline',
      positionRow: 1,
      positionCol: 0,
      width: 6,
      height: 2,
      config: {
        dataSource: 'inbox_kpis',
        metric: 'threads_opened',
        label: 'Threads abiertos · 30 días',
        rangeDays: 30,
      } satisfies SparklineConfig,
    },
    {
      kind: 'table',
      positionRow: 1,
      positionCol: 6,
      width: 6,
      height: 2,
      config: {
        dataSource: 'inbox_kpis',
        columns: [
          { key: 'subject', label: 'Asunto', format: 'text' },
          { key: 'platform', label: 'Canal', format: 'text' },
          { key: 'created_at', label: 'Abierto', format: 'date' },
        ],
        limit: 8,
      } satisfies TableConfig,
    },
    // Row 3 — text block full width
    {
      kind: 'text_block',
      positionRow: 3,
      positionCol: 0,
      width: 12,
      height: 1,
      config: {
        heading: 'Service Level Agreement',
        markdown:
          '**Compromiso de respuesta:** primer contacto en < 30 minutos durante horario laboral.\n\n- Threads críticos: respuesta inmediata + escalation\n- Threads estándar: respuesta en SLA\n- Approvals pendientes: revisión cada 4 horas',
      } satisfies TextBlockConfig,
    },
  ],
};

// ---------------------------------------------------------------------------
// Template 3 — Executive Dashboard
// ---------------------------------------------------------------------------

const EXECUTIVE_DASHBOARD: CustomReportTemplate = {
  id: 'executive_dashboard',
  name: 'Executive Dashboard',
  description:
    'Vista executive — mentions totales, NPS, ads spend, crisis count, sentiment mix, reviews trend. El reporte para subir al board meeting.',
  persona: 'C-level / Exec sponsor',
  widgets: [
    // Row 0 — 4 KPI cards (3 cols each)
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 0,
      width: 3,
      height: 1,
      config: {
        dataSource: 'listening_aggregates',
        metric: 'total_mentions',
        label: 'Total brand mentions',
        compareToPrevious: false,
        format: 'number',
      } satisfies KpiCardConfig,
    },
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 3,
      width: 3,
      height: 1,
      config: {
        dataSource: 'nps_aggregates',
        metric: 'nps_score',
        label: 'NPS score',
        format: 'number',
      } satisfies KpiCardConfig,
    },
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 6,
      width: 3,
      height: 1,
      config: {
        dataSource: 'ads_spend',
        metric: 'spend_usd',
        label: 'Ads spend MTD',
        format: 'currency_usd',
      } satisfies KpiCardConfig,
    },
    {
      kind: 'kpi_card',
      positionRow: 0,
      positionCol: 9,
      width: 3,
      height: 1,
      config: {
        dataSource: 'crisis_aggregates',
        metric: 'pending_count',
        label: 'Crisis pendientes',
        format: 'number',
      } satisfies KpiCardConfig,
    },
    // Row 1 — distribution chart (6 cols) + sparkline (6 cols)
    {
      kind: 'distribution_chart',
      positionRow: 1,
      positionCol: 0,
      width: 6,
      height: 2,
      config: {
        dataSource: 'listening_aggregates',
        groupBy: 'sentiment',
        label: 'Sentiment mix · 30 días',
        rangeDays: 30,
      } satisfies DistributionChartConfig,
    },
    {
      kind: 'sparkline',
      positionRow: 1,
      positionCol: 6,
      width: 6,
      height: 2,
      config: {
        dataSource: 'reviews_aggregates',
        metric: 'review_count',
        label: 'Reviews · 60 días',
        rangeDays: 60,
        compareToPrevious: true,
      } satisfies SparklineConfig,
    },
  ],
};

export const TEMPLATES: Record<TemplateId, CustomReportTemplate> = {
  marketing_performance: MARKETING_PERFORMANCE,
  customer_service_overview: CUSTOMER_SERVICE_OVERVIEW,
  executive_dashboard: EXECUTIVE_DASHBOARD,
};

export const TEMPLATE_LIST: ReadonlyArray<CustomReportTemplate> = [
  MARKETING_PERFORMANCE,
  CUSTOMER_SERVICE_OVERVIEW,
  EXECUTIVE_DASHBOARD,
];
