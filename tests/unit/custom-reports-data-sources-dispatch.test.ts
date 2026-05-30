import { describe, expect, it } from 'vitest';

import {
  getDataSource,
  listDataSources,
  supportsBuckets,
  supportsRows,
  supportsScalar,
  supportsTimeseries,
} from '../../lib/custom-reports/data-sources';

describe('data source registry', () => {
  it('exposes all 8 data sources', () => {
    const sources = listDataSources();
    const keys = sources.map((s) => s.key).sort();
    expect(keys).toEqual(
      [
        'ads_spend',
        'crisis_aggregates',
        'inbox_kpis',
        'listening_aggregates',
        'nps_aggregates',
        'post_insights',
        'posts_metrics',
        'reviews_aggregates',
      ].sort(),
    );
  });

  it('getDataSource throws on unknown key', () => {
    // @ts-expect-error — intentional unknown key for negative test
    expect(() => getDataSource('does_not_exist')).toThrow();
  });

  it('capability flags reflect declared metric/groupBy lists', () => {
    const inbox = getDataSource('inbox_kpis');
    expect(supportsScalar(inbox, 'avg_response_time_minutes')).toBe(true);
    expect(supportsScalar(inbox, 'not_a_metric')).toBe(false);
    expect(supportsTimeseries(inbox, 'threads_opened')).toBe(true);
    expect(supportsRows(inbox)).toBe(true);

    const listening = getDataSource('listening_aggregates');
    expect(supportsBuckets(listening, 'sentiment')).toBe(true);
    expect(supportsBuckets(listening, 'something_else')).toBe(false);
  });
});
