import { describe, expect, it } from 'vitest';

import {
  renderReportHtml,
  renderReportText,
  type ReportPayload,
} from '../../lib/scheduled-reports/report-builder';

/**
 * Phase 9 / Commit 34 — HTML + text report builder (Ajuste A).
 *
 * Verifies:
 *   - HTML is well-formed enough that the brand name + KPIs + every
 *     section header land in the output.
 *   - Reserved characters in user-controlled fields get escaped.
 *   - The text fallback is intelligible plain ASCII.
 */

const basePayload: ReportPayload = {
  brandName: 'La Trattoria',
  period: {
    label: 'Last 7 days',
    startAt: new Date('2026-05-10T00:00:00Z'),
    endAt: new Date('2026-05-17T00:00:00Z'),
  },
  kpis: {
    responseTimeMinsP50: 18,
    npsScore: 42,
    postsPublished: 31,
    adsSpendUsdCents: 124_000,
  },
  inbox: [
    {
      platform: 'instagram',
      threads: 12,
      responseTimeMinsP50: 18,
      satisfactionPct: 84,
    },
  ],
  reviews: [
    {
      platform: 'google',
      count: 8,
      avgRating: 4.6,
      responseRatePct: 75,
      sentiment: 'positive',
    },
  ],
  mentions: [
    {
      platform: 'x',
      authorHandle: 'cristina_m',
      bodyExcerpt: 'Amé el menu de la temporada en La Trattoria.',
      sentiment: 'positive',
    },
  ],
  generatedAt: new Date('2026-05-17T12:00:00Z'),
};

describe('renderReportHtml', () => {
  it('renders brand + period + KPI labels', () => {
    const html = renderReportHtml(basePayload);
    expect(html).toContain('La Trattoria');
    expect(html).toContain('Last 7 days');
    expect(html).toContain('Response p50');
    expect(html).toContain('NPS');
    expect(html).toContain('Posts published');
    expect(html).toContain('Ads spend');
  });

  it('renders the inbox + reviews + top-mentions sections', () => {
    const html = renderReportHtml(basePayload);
    expect(html).toContain('Inbox');
    expect(html).toContain('Reviews');
    expect(html).toContain('Top mentions');
    expect(html).toContain('instagram');
    expect(html).toContain('google');
    expect(html).toContain('cristina_m');
    expect(html).toContain('Amé el menu');
  });

  it('escapes reserved characters in brand name', () => {
    const html = renderReportHtml({
      ...basePayload,
      brandName: 'A&B "Bistro" <Bar>',
    });
    expect(html).toContain('A&amp;B');
    expect(html).toContain('&quot;Bistro&quot;');
    expect(html).toContain('&lt;Bar&gt;');
    expect(html).not.toContain('<Bar>');
  });

  it('hides top-mentions section when mentions are empty', () => {
    const html = renderReportHtml({ ...basePayload, mentions: [] });
    expect(html).not.toContain('Top mentions');
  });

  it('uses table-based layout for email-client compatibility', () => {
    const html = renderReportHtml(basePayload);
    // Sanity: contains <table> tags AND no flexbox/grid hints.
    expect(html).toMatch(/<table/);
    expect(html.toLowerCase()).not.toContain('display:flex');
    expect(html.toLowerCase()).not.toContain('display: flex');
    expect(html.toLowerCase()).not.toContain('display:grid');
  });
});

describe('renderReportText', () => {
  it('produces an intelligible plain-text companion', () => {
    const text = renderReportText(basePayload);
    expect(text).toContain('La Trattoria');
    expect(text).toContain('KPIs');
    expect(text).toContain('Inbox');
    expect(text).toContain('Reviews');
    expect(text).toContain('Top mentions');
    expect(text).toContain('cristina_m');
    // No HTML tags in plain text.
    expect(text).not.toContain('<');
  });
});
