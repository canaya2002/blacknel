import { describe, expect, it } from 'vitest';

import {
  distributionChartConfigSchema,
  kpiCardConfigSchema,
  sparklineConfigSchema,
  tableConfigSchema,
  textBlockConfigSchema,
  validateWidgetConfig,
} from '../../lib/custom-reports/validate';

describe('kpiCardConfigSchema', () => {
  it('accepts a valid KPI config', () => {
    expect(() =>
      kpiCardConfigSchema.parse({
        dataSource: 'inbox_kpis',
        metric: 'avg_response_time_minutes',
        label: 'Average response time',
        format: 'duration_minutes',
        compareToPrevious: true,
      }),
    ).not.toThrow();
  });

  it('rejects unknown data source', () => {
    expect(() =>
      kpiCardConfigSchema.parse({
        dataSource: 'not_real',
        metric: 'foo',
        label: 'X',
      }),
    ).toThrow();
  });
});

describe('tableConfigSchema', () => {
  it('accepts up to 8 columns', () => {
    expect(() =>
      tableConfigSchema.parse({
        dataSource: 'inbox_kpis',
        columns: Array.from({ length: 8 }, (_, i) => ({
          key: `c${i}`,
          label: `Col ${i}`,
          format: 'text' as const,
        })),
        limit: 10,
      }),
    ).not.toThrow();
  });

  it('rejects more than 8 columns', () => {
    expect(() =>
      tableConfigSchema.parse({
        dataSource: 'inbox_kpis',
        columns: Array.from({ length: 9 }, (_, i) => ({
          key: `c${i}`,
          label: `Col ${i}`,
        })),
      }),
    ).toThrow();
  });
});

describe('sparklineConfigSchema', () => {
  it('accepts valid sparkline config', () => {
    expect(() =>
      sparklineConfigSchema.parse({
        dataSource: 'reviews_aggregates',
        metric: 'avg_rating',
        label: 'Avg rating · 90d',
        rangeDays: 90,
        compareToPrevious: true,
      }),
    ).not.toThrow();
  });

  it('rejects rangeDays > 365', () => {
    expect(() =>
      sparklineConfigSchema.parse({
        dataSource: 'reviews_aggregates',
        metric: 'avg_rating',
        label: 'X',
        rangeDays: 1000,
      }),
    ).toThrow();
  });
});

describe('distributionChartConfigSchema', () => {
  it('accepts groupBy sentiment from listening', () => {
    expect(() =>
      distributionChartConfigSchema.parse({
        dataSource: 'listening_aggregates',
        groupBy: 'sentiment',
        label: 'Mentions by sentiment',
      }),
    ).not.toThrow();
  });

  it('rejects unknown extra field (strict mode)', () => {
    expect(() =>
      distributionChartConfigSchema.parse({
        dataSource: 'listening_aggregates',
        groupBy: 'sentiment',
        label: 'X',
        extra_invalid_field: true,
      }),
    ).toThrow();
  });
});

describe('textBlockConfigSchema', () => {
  it('accepts non-empty markdown', () => {
    expect(() =>
      textBlockConfigSchema.parse({
        markdown: '**Hello world**',
        heading: 'Notes',
      }),
    ).not.toThrow();
  });

  it('rejects empty markdown', () => {
    expect(() =>
      textBlockConfigSchema.parse({
        markdown: '',
      }),
    ).toThrow();
  });
});

describe('validateWidgetConfig dispatcher', () => {
  it('dispatches correctly per kind', () => {
    expect(() =>
      validateWidgetConfig('kpi_card', {
        dataSource: 'inbox_kpis',
        metric: 'threads_pending_approval_count',
        label: 'X',
      }),
    ).not.toThrow();
  });

  it('rejects payload that fits a different kind', () => {
    // payload missing markdown — would be valid for kpi_card but not text_block
    expect(() =>
      validateWidgetConfig('text_block', {
        dataSource: 'inbox_kpis',
        metric: 'x',
        label: 'X',
      }),
    ).toThrow();
  });
});
