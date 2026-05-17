import { describe, expect, it } from 'vitest';

import {
  groupByArea,
  summarize,
} from '../../lib/custom-roles/catalog';
import { ALL_PERMISSIONS } from '../../lib/permissions/roles';

/**
 * Phase 10 / Commit 36b — permission picker catalog tests.
 */

describe('groupByArea', () => {
  it('empty query → returns every area with at least one permission', () => {
    const groups = groupByArea('');
    expect(groups.length).toBeGreaterThan(5);
    const totalEntries = groups.reduce(
      (sum, g) => sum + g.entries.length,
      0,
    );
    expect(totalEntries).toBe(ALL_PERMISSIONS.length);
  });

  it('matches by permission name (case-insensitive)', () => {
    const groups = groupByArea('INBOX');
    const allPerms = groups.flatMap((g) => g.entries.map((e) => e.permission));
    expect(allPerms.every((p) => p.startsWith('inbox:'))).toBe(true);
    expect(allPerms.length).toBeGreaterThan(0);
  });

  it('matches by tooltip text', () => {
    // 'destructiva' is in the tooltip for posts:delete and
    // integrations:manage. Search should return both.
    const groups = groupByArea('destructiva');
    const allPerms = groups.flatMap((g) => g.entries.map((e) => e.permission));
    expect(allPerms).toContain('posts:delete');
    expect(allPerms).toContain('integrations:manage');
  });
});

describe('summarize', () => {
  it('zero grants, zero revokes → effective = base count', () => {
    const s = summarize(10, [], []);
    expect(s.grantsCount).toBe(0);
    expect(s.revokesCount).toBe(0);
    expect(s.effectiveCount).toBe(10);
  });

  it('grants add to effective, revokes subtract (conservative)', () => {
    const s = summarize(10, ['inbox:read', 'posts:create'], ['posts:delete']);
    expect(s.grantsCount).toBe(2);
    expect(s.revokesCount).toBe(1);
    expect(s.effectiveCount).toBe(11);
  });
});
