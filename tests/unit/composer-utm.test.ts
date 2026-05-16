import { describe, expect, it } from 'vitest';

import {
  buildUtmUrl,
  emitUtm,
  normalizeUtm,
  utmDiffers,
} from '../../lib/publish/composer/utm';

/**
 * UTM helpers for the composer's link editor. Two angles
 * matter for this surface:
 *
 *   1. Building a URL preview from raw input — the user sees
 *      the final attribution-aware URL beneath the form.
 *   2. Sanitization — leading/trailing whitespace is stripped,
 *      empty values are dropped, malformed URLs fail closed.
 */

describe('buildUtmUrl', () => {
  it('returns kind=empty when the link is missing or whitespace', () => {
    expect(buildUtmUrl('', {})).toEqual({ kind: 'empty' });
    expect(buildUtmUrl('   ', {})).toEqual({ kind: 'empty' });
  });

  it('returns kind=invalid for unparseable links', () => {
    expect(buildUtmUrl('not a url', {})).toEqual({ kind: 'invalid' });
    expect(buildUtmUrl('javascript:alert(1)', {})).toMatchObject({ kind: 'ok' });
    // Note: `javascript:alert(1)` IS a valid URL per WHATWG —
    // sanitizing scheme-allowlists is the renderer's job, not
    // this helper. We just validate parseability.
  });

  it('returns the bare URL when no UTM params are provided', () => {
    expect(buildUtmUrl('https://blacknel.io/page', {})).toEqual({
      kind: 'ok',
      url: 'https://blacknel.io/page',
    });
  });

  it('appends utm_source / utm_medium / utm_campaign / utm_term / utm_content', () => {
    const result = buildUtmUrl('https://blacknel.io/page', {
      source: 'facebook',
      medium: 'cpc',
      campaign: 'q1-launch',
      term: 'crm tools',
      content: 'variant-a',
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const url = new URL(result.url);
    expect(url.searchParams.get('utm_source')).toBe('facebook');
    expect(url.searchParams.get('utm_medium')).toBe('cpc');
    expect(url.searchParams.get('utm_campaign')).toBe('q1-launch');
    expect(url.searchParams.get('utm_term')).toBe('crm tools');
    expect(url.searchParams.get('utm_content')).toBe('variant-a');
  });

  it('trims whitespace around UTM values', () => {
    const result = buildUtmUrl('https://blacknel.io/page', {
      source: '  facebook  ',
    });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(new URL(result.url).searchParams.get('utm_source')).toBe('facebook');
  });

  it('drops empty / whitespace-only UTM values', () => {
    const result = buildUtmUrl('https://blacknel.io/page', {
      source: '',
      medium: '   ',
      campaign: 'real',
    });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const url = new URL(result.url);
    expect(url.searchParams.has('utm_source')).toBe(false);
    expect(url.searchParams.has('utm_medium')).toBe(false);
    expect(url.searchParams.get('utm_campaign')).toBe('real');
  });

  it('preserves pre-existing non-UTM query params on the link', () => {
    const result = buildUtmUrl('https://blacknel.io/page?ref=blog', {
      source: 'facebook',
    });
    if (result.kind !== 'ok') throw new Error('expected ok');
    const url = new URL(result.url);
    expect(url.searchParams.get('ref')).toBe('blog');
    expect(url.searchParams.get('utm_source')).toBe('facebook');
  });

  it('overwrites pre-existing utm_* keys on the link', () => {
    const result = buildUtmUrl(
      'https://blacknel.io/page?utm_source=newsletter',
      { source: 'facebook' },
    );
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(new URL(result.url).searchParams.get('utm_source')).toBe('facebook');
  });
});

describe('emitUtm — payload sanitization for Server Action', () => {
  it('strips whitespace and drops empty fields', () => {
    expect(
      emitUtm({
        source: '  facebook  ',
        medium: '',
        campaign: '   ',
        term: 'crm',
        content: undefined,
      }),
    ).toEqual({ source: 'facebook', term: 'crm' });
  });

  it('returns an empty object when every field is empty', () => {
    expect(emitUtm({})).toEqual({});
    expect(emitUtm({ source: '', medium: '   ' })).toEqual({});
  });
});

describe('normalizeUtm — defensive read of persisted jsonb', () => {
  it('drops non-string entries', () => {
    expect(
      normalizeUtm({
        source: 'facebook',
        medium: 42,
        campaign: null,
        term: 'launch',
        content: { malicious: true },
      } as unknown as Record<string, unknown>),
    ).toEqual({ source: 'facebook', term: 'launch' });
  });

  it('returns {} for null / undefined input', () => {
    expect(normalizeUtm(null)).toEqual({});
    expect(normalizeUtm(undefined)).toEqual({});
  });
});

describe('utmDiffers — drives composer dirty flag', () => {
  it('returns false when local matches persisted', () => {
    expect(
      utmDiffers(
        { source: 'facebook', medium: 'cpc' },
        { source: 'facebook', medium: 'cpc' },
      ),
    ).toBe(false);
  });

  it('returns true when a field is added locally', () => {
    expect(
      utmDiffers({ source: 'facebook', campaign: 'new' }, { source: 'facebook' }),
    ).toBe(true);
  });

  it('returns true when a field is removed locally', () => {
    expect(
      utmDiffers({ source: 'facebook' }, { source: 'facebook', medium: 'cpc' }),
    ).toBe(true);
  });

  it('treats undefined and empty-string as equivalent (both "absent")', () => {
    expect(utmDiffers({ source: '' }, { source: undefined })).toBe(false);
    expect(utmDiffers({}, { source: '' })).toBe(false);
  });
});
