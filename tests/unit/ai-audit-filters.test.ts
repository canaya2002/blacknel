import { describe, expect, it } from 'vitest';

import { parseAiAuditFilters } from '../../lib/ai/audit-filters';

describe('parseAiAuditFilters — happy path', () => {
  it('returns empty filters for empty input', () => {
    expect(parseAiAuditFilters({})).toEqual({});
  });

  it('parses skill, model, range', () => {
    const out = parseAiAuditFilters({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      range: '30d',
    });
    expect(out.skill).toBe('compliance');
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.range).toBe('30d');
    expect(out.since).toBeInstanceOf(Date);
  });

  it('converts range=7d to a since ~7 days in the past', () => {
    const out = parseAiAuditFilters({ range: '7d' });
    const diffDays = (Date.now() - out.since!.getTime()) / 86_400_000;
    expect(diffDays).toBeGreaterThan(6.9);
    expect(diffDays).toBeLessThan(7.1);
  });
});

describe('parseAiAuditFilters — drop-on-suspect', () => {
  it('drops skill when not in allow list', () => {
    const out = parseAiAuditFilters({ skill: 'evil_skill' });
    expect(out.skill).toBeUndefined();
  });

  it('drops model when unknown', () => {
    const out = parseAiAuditFilters({ model: 'gpt-4' });
    expect(out.model).toBeUndefined();
  });

  it('drops range when not 7d/30d/90d', () => {
    const out = parseAiAuditFilters({ range: '14d' });
    expect(out.range).toBeUndefined();
    expect(out.since).toBeUndefined();
  });
});
