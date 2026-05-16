import { describe, expect, it } from 'vitest';

import {
  encodeInboxFilters,
  hasActiveFilters,
  parseInboxFilters,
} from '../../lib/inbox/filters';

describe('parseInboxFilters', () => {
  it('returns empty filters for an empty input', () => {
    expect(parseInboxFilters({})).toEqual({ filters: {} });
    expect(parseInboxFilters(new URLSearchParams())).toEqual({ filters: {} });
  });

  it('parses multi-value allow-listed filters', () => {
    const { filters } = parseInboxFilters(
      new URLSearchParams('status=open,pending&priority=urgent,high'),
    );
    expect(filters.status).toEqual(['open', 'pending']);
    expect(filters.priority).toEqual(['urgent', 'high']);
  });

  it('drops the entire filter when ANY value falls outside the allow-list', () => {
    // platform=facebook,evil_injection → the whole `platform` filter is
    // discarded, NOT just the bad value. Partial acceptance would hide
    // results from the user.
    const { filters } = parseInboxFilters(
      new URLSearchParams('platform=facebook,evil_injection'),
    );
    expect(filters.platform).toBeUndefined();
  });

  it('dedupes repeated values', () => {
    const { filters } = parseInboxFilters(
      new URLSearchParams('status=open,open,open'),
    );
    expect(filters.status).toEqual(['open']);
  });

  it('accepts `me` and `unassigned` for assignedTo, validates UUIDs otherwise', () => {
    expect(parseInboxFilters(new URLSearchParams('assignedTo=me')).filters.assignedTo).toBe('me');
    expect(
      parseInboxFilters(new URLSearchParams('assignedTo=unassigned')).filters.assignedTo,
    ).toBe('unassigned');
    expect(
      parseInboxFilters(
        new URLSearchParams('assignedTo=22222222-2222-4222-8222-220000000001'),
      ).filters.assignedTo,
    ).toBe('22222222-2222-4222-8222-220000000001');
    expect(
      parseInboxFilters(new URLSearchParams('assignedTo=not-a-uuid')).filters.assignedTo,
    ).toBeUndefined();
  });

  it('validates brandId / locationId as UUIDs', () => {
    expect(parseInboxFilters(new URLSearchParams('brandId=bogus')).filters.brandId).toBeUndefined();
    expect(parseInboxFilters(new URLSearchParams('locationId=bogus')).filters.locationId).toBeUndefined();
  });

  it('caps `q` at 200 chars and lowercases', () => {
    const long = 'A'.repeat(500);
    const { filters } = parseInboxFilters(new URLSearchParams(`q=${long}`));
    expect(filters.q?.length).toBe(200);
    expect(filters.q).toBe(filters.q?.toLowerCase());
  });

  it('treats SQL-injection-shaped q as plain text (sanitisation lives in the query layer)', () => {
    // Parsing is only responsible for normalization. The query layer
    // wraps q in plainto_tsquery which strips tsquery operators.
    const { filters } = parseInboxFilters(
      new URLSearchParams("q='; DROP TABLE inbox_threads; --"),
    );
    expect(filters.q).toBe("'; drop table inbox_threads; --");
  });

  it('rejects tags outside [a-z0-9_-] and over MAX_TAGS', () => {
    expect(
      parseInboxFilters(new URLSearchParams('tags=foo,<script>')).filters.tags,
    ).toBeUndefined();
    const tooMany = parseInboxFilters(
      new URLSearchParams('tags=a,b,c,d,e,f,g,h,i,j,k'),
    ).filters.tags;
    // The first MAX_TAGS=8 are kept and validated; the overflow is dropped.
    expect(tooMany?.length).toBe(8);
  });

  it('preserves the cursor field separately from filters', () => {
    const parsed = parseInboxFilters(
      new URLSearchParams('status=open&cursor=abc'),
    );
    expect(parsed.filters.status).toEqual(['open']);
    expect(parsed.cursor).toBe('abc');
  });

  it('returns no cursor when not provided', () => {
    expect(parseInboxFilters(new URLSearchParams('status=open')).cursor).toBeUndefined();
  });
});

describe('hasActiveFilters', () => {
  it('is false when filter object is empty', () => {
    expect(hasActiveFilters({})).toBe(false);
  });

  it('is true when any single filter is set', () => {
    expect(hasActiveFilters({ status: ['open'] })).toBe(true);
    expect(hasActiveFilters({ q: 'foo' })).toBe(true);
    expect(hasActiveFilters({ assignedTo: 'me' })).toBe(true);
  });

  it('is false when arrays are empty', () => {
    expect(hasActiveFilters({ status: [], priority: [] })).toBe(false);
  });
});

describe('encodeInboxFilters', () => {
  it('round-trips a typical filter set through URL params', () => {
    const filters = {
      status: ['open', 'pending'] as const,
      priority: ['urgent'] as const,
      q: 'reembolso',
    };
    const encoded = encodeInboxFilters(filters);
    const reparsed = parseInboxFilters(encoded);
    expect(reparsed.filters.status).toEqual(filters.status);
    expect(reparsed.filters.priority).toEqual(filters.priority);
    expect(reparsed.filters.q).toBe(filters.q);
  });

  it('appends the cursor when provided', () => {
    const encoded = encodeInboxFilters({ status: ['open'] }, { cursor: 'CUR' });
    expect(encoded.get('cursor')).toBe('CUR');
  });

  it('omits empty filter arrays', () => {
    const encoded = encodeInboxFilters({ status: [], priority: [] });
    expect(encoded.toString()).toBe('');
  });
});
