import { describe, expect, it } from 'vitest';

import { scanForMentionsMock } from '../../lib/connectors/listening/mock';

/**
 * Phase 9 / Commit 33 — deterministic mock connector (Ajuste B).
 *
 * Same `(orgId, trackedTermId, dayKey)` MUST yield the same
 * mention set. Volume bands by `termKind`:
 *
 *   - handle   → 5-20 mentions/day
 *   - hashtag  → 2-12 mentions/day
 *   - keyword  → 0-5  mentions/day
 *
 * Across days, the output differs (otherwise the demo sits on a
 * single batch forever).
 */

describe('scanForMentionsMock', () => {
  const baseInput = {
    orgId: '11111111-1111-4111-8111-c3300c3300c0',
    trackedTermId: 'aaaaaaaa-aaaa-4aaa-8aaa-c3300c3300c0',
    term: 'mi marca',
    platforms: ['x', 'instagram'],
  };

  it('is deterministic per (orgId, term, day)', () => {
    const now = new Date('2026-05-17T12:00:00Z');
    const a = scanForMentionsMock({
      ...baseInput,
      termKind: 'handle',
      now,
    });
    const b = scanForMentionsMock({
      ...baseInput,
      termKind: 'handle',
      now,
    });
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThanOrEqual(5);
    expect(a.length).toBeLessThanOrEqual(20);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]!.externalId).toBe(b[i]!.externalId);
      expect(a[i]!.body).toBe(b[i]!.body);
      expect(a[i]!.hintSentiment).toBe(b[i]!.hintSentiment);
    }
  });

  it('changes the mention set across days', () => {
    const day1 = new Date('2026-05-17T12:00:00Z');
    const day2 = new Date('2026-05-18T12:00:00Z');
    const a = scanForMentionsMock({
      ...baseInput,
      termKind: 'handle',
      now: day1,
    });
    const b = scanForMentionsMock({
      ...baseInput,
      termKind: 'handle',
      now: day2,
    });
    // At least one externalId must differ (the day-keyed suffix
    // changes for every mention).
    const aIds = new Set(a.map((m) => m.externalId));
    const bIds = new Set(b.map((m) => m.externalId));
    let overlap = 0;
    for (const id of aIds) if (bIds.has(id)) overlap += 1;
    expect(overlap).toBe(0);
  });

  it('respects volume ranges by termKind', () => {
    const now = new Date('2026-05-17T12:00:00Z');
    const handle = scanForMentionsMock({
      ...baseInput,
      termKind: 'handle',
      now,
    });
    const hashtag = scanForMentionsMock({
      ...baseInput,
      termKind: 'hashtag',
      now,
    });
    const keyword = scanForMentionsMock({
      ...baseInput,
      termKind: 'keyword',
      now,
    });
    expect(handle.length).toBeGreaterThanOrEqual(5);
    expect(handle.length).toBeLessThanOrEqual(20);
    expect(hashtag.length).toBeGreaterThanOrEqual(2);
    expect(hashtag.length).toBeLessThanOrEqual(12);
    expect(keyword.length).toBeGreaterThanOrEqual(0);
    expect(keyword.length).toBeLessThanOrEqual(5);
  });

  it('embeds the term verbatim into every mention body', () => {
    const now = new Date('2026-05-17T12:00:00Z');
    const term = 'TestBrand-XYZ';
    const out = scanForMentionsMock({
      ...baseInput,
      term,
      termKind: 'hashtag',
      now,
    });
    expect(out.length).toBeGreaterThan(0);
    for (const m of out) {
      expect(m.body).toContain(term);
    }
  });
});
