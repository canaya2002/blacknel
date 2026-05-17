import { describe, expect, it } from 'vitest';

import {
  allowedCampaignTransitionsFrom,
  canTransitionCampaignStatus,
  isCampaignStatusTerminal,
  type CampaignStatus,
} from '../../lib/campaigns/validate';

/**
 * Positive + negative coverage of the campaign lifecycle graph
 * (Commit 21, B1). The graph lives in
 * `lib/campaigns/validate.ts`; this test is the single canonical
 * place that locks the matrix. If the graph changes, both the
 * function AND this test fixture must update.
 *
 *     draft     → active
 *     draft     → archived
 *     active    → paused
 *     active    → completed
 *     paused    → active
 *     paused    → archived
 *     completed → archived
 *
 * Everything else (including self-transitions) is disallowed.
 */

const ALL: ReadonlyArray<CampaignStatus> = [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
];

const ALLOWED: ReadonlyArray<[CampaignStatus, CampaignStatus]> = [
  ['draft', 'active'],
  ['draft', 'archived'],
  ['active', 'paused'],
  ['active', 'completed'],
  ['paused', 'active'],
  ['paused', 'archived'],
  ['completed', 'archived'],
];

describe('canTransitionCampaignStatus — positive', () => {
  for (const [from, to] of ALLOWED) {
    it(`allows ${from} → ${to}`, () => {
      expect(canTransitionCampaignStatus(from, to)).toBe(true);
    });
  }
});

describe('canTransitionCampaignStatus — negative', () => {
  it('disallows every self-transition', () => {
    for (const s of ALL) {
      expect(canTransitionCampaignStatus(s, s)).toBe(false);
    }
  });

  // Every other (from, to) combination not in ALLOWED must return false.
  for (const from of ALL) {
    for (const to of ALL) {
      if (from === to) continue;
      const isAllowed = ALLOWED.some(([f, t]) => f === from && t === to);
      if (isAllowed) continue;
      it(`disallows ${from} → ${to}`, () => {
        expect(canTransitionCampaignStatus(from, to)).toBe(false);
      });
    }
  }
});

describe('allowedCampaignTransitionsFrom', () => {
  it('returns exactly the allowed edges for each source', () => {
    expect(allowedCampaignTransitionsFrom('draft')).toEqual(['active', 'archived']);
    expect(allowedCampaignTransitionsFrom('active')).toEqual(['paused', 'completed']);
    expect(allowedCampaignTransitionsFrom('paused')).toEqual(['active', 'archived']);
    expect(allowedCampaignTransitionsFrom('completed')).toEqual(['archived']);
    expect(allowedCampaignTransitionsFrom('archived')).toEqual([]);
  });
});

describe('isCampaignStatusTerminal', () => {
  it('only archived is terminal', () => {
    expect(isCampaignStatusTerminal('archived')).toBe(true);
    expect(isCampaignStatusTerminal('draft')).toBe(false);
    expect(isCampaignStatusTerminal('active')).toBe(false);
    expect(isCampaignStatusTerminal('paused')).toBe(false);
    expect(isCampaignStatusTerminal('completed')).toBe(false);
  });
});
