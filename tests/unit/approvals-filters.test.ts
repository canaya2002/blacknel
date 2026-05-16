import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FILTERS,
  encodeApprovalFilters,
  hasActiveFilters,
  parseApprovalFilters,
} from '../../lib/approvals/filters';

describe('parseApprovalFilters', () => {
  it('applies DEFAULT_FILTERS when the URL is empty', () => {
    const parsed = parseApprovalFilters({});
    expect(parsed.defaulted).toBe(true);
    expect(parsed.filters).toEqual(DEFAULT_FILTERS);
  });

  it('drops defaults the moment any filter is explicit', () => {
    const { filters, defaulted } = parseApprovalFilters(
      new URLSearchParams('status=approved'),
    );
    expect(defaulted).toBe(false);
    expect(filters.status).toEqual(['approved']);
  });

  it('parses multi-value allow-listed filters', () => {
    const { filters } = parseApprovalFilters(
      new URLSearchParams('kind=inbox_reply,post&riskLevel=high,critical'),
    );
    expect(filters.kind).toEqual(['inbox_reply', 'post']);
    expect(filters.riskLevel).toEqual(['high', 'critical']);
  });

  it('drops the whole filter on ANY out-of-allowlist value', () => {
    // We pair the bad filter with a valid one so defaults don't fire —
    // that way we can assert the bad filter alone was dropped without
    // the default fallback masking the result.
    const a = parseApprovalFilters(
      new URLSearchParams('kind=inbox_reply&status=pending,evil_injection'),
    );
    expect(a.filters.kind).toEqual(['inbox_reply']);
    expect(a.filters.status).toBeUndefined();

    const b = parseApprovalFilters(
      new URLSearchParams('kind=inbox_reply&riskLevel=high,bogus'),
    );
    expect(b.filters.riskLevel).toBeUndefined();
  });

  it('dedupes repeated values', () => {
    const { filters } = parseApprovalFilters(
      new URLSearchParams('status=pending,pending,pending'),
    );
    expect(filters.status).toEqual(['pending']);
  });

  it('accepts me/unassigned/UUID for assignedTo, rejects otherwise', () => {
    expect(parseApprovalFilters(new URLSearchParams('assignedTo=me')).filters.assignedTo).toBe(
      'me',
    );
    expect(
      parseApprovalFilters(new URLSearchParams('assignedTo=unassigned')).filters
        .assignedTo,
    ).toBe('unassigned');
    expect(
      parseApprovalFilters(
        new URLSearchParams('assignedTo=22222222-2222-4222-8222-220000000001'),
      ).filters.assignedTo,
    ).toBe('22222222-2222-4222-8222-220000000001');
    expect(
      parseApprovalFilters(new URLSearchParams('assignedTo=garbage')).filters.assignedTo,
    ).toBeUndefined();
  });

  it('cursor disables defaults even with no filters', () => {
    const { filters, defaulted, cursor } = parseApprovalFilters(
      new URLSearchParams('cursor=eyJ'),
    );
    expect(defaulted).toBe(false);
    expect(filters).toEqual({});
    expect(cursor).toBe('eyJ');
  });
});

describe('encodeApprovalFilters + round-trip', () => {
  it('round-trips a typical filter set', () => {
    const filters = {
      status: ['pending', 'escalated'] as const,
      kind: ['inbox_reply'] as const,
      riskLevel: ['high'] as const,
    };
    const params = encodeApprovalFilters(filters);
    const { filters: out } = parseApprovalFilters(params);
    expect(out).toEqual(filters);
  });

  it('serialises an empty filter set to an empty query', () => {
    expect(encodeApprovalFilters({}).toString()).toBe('');
  });

  it('hasActiveFilters reports correctly', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ status: ['pending'] })).toBe(true);
    expect(hasActiveFilters({ status: [] })).toBe(false);
  });
});
