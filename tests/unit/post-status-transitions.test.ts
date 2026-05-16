import { describe, expect, it } from 'vitest';

import {
  allowedTransitionsFrom,
  canTransition,
  isTerminal,
  type PostStatus,
} from '../../lib/publish/status-transitions';

/**
 * `posts.status` lifecycle table — see `_enums.ts` for the prose
 * version. These tests are the executable spec.
 */

describe('canTransition — legal transitions', () => {
  const legal: Array<[PostStatus, PostStatus]> = [
    ['draft', 'scheduled'],
    ['draft', 'pending_approval'],
    ['draft', 'published'],
    ['draft', 'cancelled'],
    ['pending_approval', 'scheduled'],
    ['pending_approval', 'publishing'],
    ['pending_approval', 'cancelled'],
    ['scheduled', 'publishing'],
    ['scheduled', 'cancelled'],
    ['scheduled', 'draft'],
    ['publishing', 'published'],
    ['publishing', 'failed'],
    ['failed', 'scheduled'],
    ['failed', 'draft'],
  ];

  for (const [from, to] of legal) {
    it(`${from} → ${to} is allowed`, () => {
      expect(canTransition(from, to)).toBe(true);
    });
  }
});

describe('canTransition — illegal transitions', () => {
  const illegal: Array<[PostStatus, PostStatus]> = [
    // Terminal states never transition.
    ['published', 'scheduled'],
    ['published', 'draft'],
    ['published', 'cancelled'],
    ['cancelled', 'draft'],
    ['cancelled', 'scheduled'],
    // Self-transitions are not allowed (no-op semantics).
    ['draft', 'draft'],
    ['scheduled', 'scheduled'],
    // Skip-the-state transitions.
    ['draft', 'publishing'],
    ['scheduled', 'published'],
    ['failed', 'published'],
    ['pending_approval', 'published'],
    // Backwards from publishing.
    ['publishing', 'scheduled'],
    ['publishing', 'draft'],
    ['publishing', 'cancelled'],
  ];

  for (const [from, to] of illegal) {
    it(`${from} → ${to} is NOT allowed`, () => {
      expect(canTransition(from, to)).toBe(false);
    });
  }
});

describe('isTerminal', () => {
  it('returns true for published and cancelled', () => {
    expect(isTerminal('published')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
  });

  it('returns false for every non-terminal state', () => {
    for (const s of [
      'draft',
      'pending_approval',
      'scheduled',
      'publishing',
      'failed',
    ] as PostStatus[]) {
      expect(isTerminal(s)).toBe(false);
    }
  });
});

describe('allowedTransitionsFrom', () => {
  it('returns the canonical set for draft', () => {
    expect([...allowedTransitionsFrom('draft')].sort()).toEqual(
      ['cancelled', 'pending_approval', 'published', 'scheduled'].sort(),
    );
  });

  it('returns empty for terminal states', () => {
    expect(allowedTransitionsFrom('published')).toEqual([]);
    expect(allowedTransitionsFrom('cancelled')).toEqual([]);
  });
});
