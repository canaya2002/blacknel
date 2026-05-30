import { afterEach, describe, expect, it } from 'vitest';

import type { OrgBranding } from '../../lib/branding/org-branding';
import { resolveOrgBranding } from '../../lib/branding/org-branding';
import { _setGraphFetchForTests } from '../../lib/connectors/meta/graph';
import { fetchMetaPostInsights } from '../../lib/connectors/meta/post-insights';
import { buildPdf, hexToRgb } from '../../lib/reports/pdf/pdf-builder';
import { renderBrandedReportPdf } from '../../lib/reports/pdf/render-report';

/**
 * C52 unit coverage: the dependency-free PDF builder + branded renderer (bytes +
 * branding), the org-branding resolver (defaults + validation), and the real
 * Meta per-post insights mapping via the graph fetch seam (zero network).
 */

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

describe('pdf-builder', () => {
  it('emits a structurally valid single-page PDF', () => {
    const pdf = buildPdf({
      texts: [{ x: 50, y: 700, size: 12, text: 'Hello World' }],
      rects: [{ x: 0, y: 800, w: 595, h: 42, color: [1, 0, 0] }],
    });
    const s = latin1(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('/Type /Catalog');
    expect(s).toContain('Helvetica');
    expect(s).toContain('(Hello World) Tj');
    expect(s).toContain('1 0 0 rg'); // red rect fill
    expect(s).toContain('xref');
    expect(s).toContain('startxref');
  });

  it('escapes parentheses + backslashes in text', () => {
    const s = latin1(buildPdf({ texts: [{ x: 0, y: 0, size: 10, text: 'a(b)c\\d' }], rects: [] }));
    expect(s).toContain('(a\\(b\\)c\\\\d) Tj');
  });

  it('hexToRgb parses #rrggbb and rejects junk', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb('not-a-color')).toEqual([0, 0, 0]);
  });
});

describe('renderBrandedReportPdf', () => {
  const branding: OrgBranding = {
    displayName: 'Acme Agency',
    logoUrl: null,
    primaryColor: '#112233',
    secondaryColor: '#445566',
    locale: 'en',
  };

  it('renders the org display name + section titles + KPIs into the PDF', () => {
    const pdf = renderBrandedReportPdf({
      branding,
      title: 'Analytics Report',
      periodLabel: 'Last 30 days',
      generatedAtLabel: '2026-05-30',
      sections: [
        { title: 'Reviews', kpis: [{ label: 'Avg rating', value: '4.7' }] },
        { title: 'Ads', kpis: [{ label: 'Spend (USD)', value: '1200' }] },
      ],
    });
    const s = latin1(pdf);
    expect(s.startsWith('%PDF')).toBe(true);
    expect(s).toContain('(Acme Agency) Tj');
    expect(s).toContain('(Reviews) Tj');
    expect(s).toContain('(Avg rating) Tj');
    expect(s).toContain('(4.7) Tj');
    expect(s).toContain('(Ads) Tj');
  });
});

describe('resolveOrgBranding', () => {
  it('falls back to Blacknel defaults when unset', () => {
    const b = resolveOrgBranding({
      name: 'Org X',
      displayName: null,
      logoUrl: null,
      primaryColor: null,
      secondaryColor: null,
      locale: null,
    });
    expect(b.displayName).toBe('Org X'); // org name when no display_name
    expect(b.primaryColor).toBe('#5b3df5');
    expect(b.locale).toBe('en');
  });

  it('uses set branding + validates hex colors', () => {
    const b = resolveOrgBranding({
      name: 'Org X',
      displayName: 'Cool Brand',
      logoUrl: 'https://cdn/logo.png',
      primaryColor: '#ABCDEF',
      secondaryColor: 'garbage',
      locale: 'es',
    });
    expect(b.displayName).toBe('Cool Brand');
    expect(b.primaryColor).toBe('#abcdef');
    expect(b.secondaryColor).toBe('#1f2328'); // invalid → default
    expect(b.locale).toBe('es');
  });
});

describe('fetchMetaPostInsights (graph seam)', () => {
  afterEach(() => _setGraphFetchForTests(null));

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('maps a facebook post: insights + likes/comments/shares summaries', async () => {
    _setGraphFetchForTests(async () =>
      json({
        likes: { summary: { total_count: 10 } },
        comments: { summary: { total_count: 3 } },
        shares: { count: 2 },
        insights: {
          data: [
            { name: 'post_impressions', values: [{ value: 1000 }] },
            { name: 'post_impressions_unique', values: [{ value: 700 }] },
            { name: 'post_engaged_users', values: [{ value: 50 }] },
          ],
        },
      }),
    );
    const r = await fetchMetaPostInsights('facebook', 'fb_post_1', 'tok');
    expect(r).toEqual({
      platform: 'facebook',
      externalPostId: 'fb_post_1',
      reach: 700,
      impressions: 1000,
      likes: 10,
      comments: 3,
      shares: 2,
      engagement: 50,
    });
  });

  it('maps an instagram media: like_count/comments_count + insights', async () => {
    _setGraphFetchForTests(async () =>
      json({
        like_count: 20,
        comments_count: 5,
        insights: {
          data: [
            { name: 'reach', values: [{ value: 500 }] },
            { name: 'impressions', values: [{ value: 800 }] },
            { name: 'engagement', values: [{ value: 40 }] },
          ],
        },
      }),
    );
    const r = await fetchMetaPostInsights('instagram', 'ig_1', 'tok');
    expect(r).toMatchObject({ platform: 'instagram', reach: 500, impressions: 800, likes: 20, comments: 5, shares: 0, engagement: 40 });
  });
});
