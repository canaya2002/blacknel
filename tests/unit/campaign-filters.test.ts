import { describe, expect, it } from 'vitest';

import {
  hasActiveCampaignFilters,
  parseCampaignFilters,
} from '../../lib/campaigns/filters';

describe('parseCampaignFilters — happy path', () => {
  it('returns empty filters for empty input', () => {
    expect(parseCampaignFilters({})).toEqual({});
  });

  it('parses allow-listed status, goal, brandId, q, dates', () => {
    const f = parseCampaignFilters({
      status: 'active',
      goal: 'launch',
      brandId: '00000000-0000-4000-8000-000000000001',
      q: 'Mayo',
      startsFrom: '2026-05-01',
      startsTo: '2026-05-31',
    });
    expect(f.status).toEqual(['active']);
    expect(f.goal).toBe('launch');
    expect(f.brandId).toBe('00000000-0000-4000-8000-000000000001');
    expect(f.q).toBe('Mayo');
    expect(f.startsFrom).toBe('2026-05-01');
    expect(f.startsTo).toBe('2026-05-31');
  });

  it('accepts a comma-separated multi-status filter', () => {
    const f = parseCampaignFilters({ status: 'draft,active' });
    expect(f.status).toEqual(expect.arrayContaining(['draft', 'active']));
    expect(f.status?.length).toBe(2);
  });
});

describe('parseCampaignFilters — drop-on-suspect', () => {
  it('drops status filter when any value is out of the allow-list', () => {
    const f = parseCampaignFilters({ status: 'draft,evil' });
    expect(f.status).toBeUndefined();
  });

  it('drops goal filter for unknown goal', () => {
    const f = parseCampaignFilters({ goal: 'unknown_goal' });
    expect(f.goal).toBeUndefined();
  });

  it('drops brandId when not a UUID', () => {
    const f = parseCampaignFilters({ brandId: 'not-a-uuid' });
    expect(f.brandId).toBeUndefined();
  });

  it('drops q when too long', () => {
    const f = parseCampaignFilters({ q: 'a'.repeat(300) });
    expect(f.q).toBeUndefined();
  });

  it('drops both date bounds when from > to', () => {
    const f = parseCampaignFilters({
      startsFrom: '2026-12-31',
      startsTo: '2026-01-01',
    });
    expect(f.startsFrom).toBeUndefined();
    expect(f.startsTo).toBeUndefined();
  });

  it('drops both date bounds when range > 365 days', () => {
    const f = parseCampaignFilters({
      startsFrom: '2025-01-01',
      startsTo: '2027-01-01',
    });
    expect(f.startsFrom).toBeUndefined();
    expect(f.startsTo).toBeUndefined();
  });

  it('drops malformed dates', () => {
    const f = parseCampaignFilters({ startsFrom: 'not-a-date' });
    expect(f.startsFrom).toBeUndefined();
  });
});

describe('hasActiveCampaignFilters', () => {
  it('returns false for empty filters', () => {
    expect(hasActiveCampaignFilters({})).toBe(false);
  });
  it('returns true for any populated filter', () => {
    expect(hasActiveCampaignFilters({ status: ['active'] })).toBe(true);
    expect(hasActiveCampaignFilters({ goal: 'launch' })).toBe(true);
    expect(hasActiveCampaignFilters({ q: 'foo' })).toBe(true);
  });
});
