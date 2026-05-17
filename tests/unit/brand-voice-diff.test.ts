import { describe, expect, it } from 'vitest';

import { diffApprovalRules } from '../../lib/brand-voice/diff';

const empty = {
  requireApprovalForPosts: false,
  requireApprovalForPostsOnPlatforms: [],
  requireApprovalForCampaignTypes: [],
};

describe('diffApprovalRules — null on no change', () => {
  it('returns null when before === after', () => {
    expect(diffApprovalRules(empty, { ...empty })).toBeNull();
  });

  it('returns null for two equivalent-but-non-identical objects', () => {
    expect(
      diffApprovalRules(
        {
          requireApprovalForPosts: true,
          requireApprovalForPostsOnPlatforms: ['facebook', 'instagram'],
          requireApprovalForCampaignTypes: ['launch'],
        },
        {
          requireApprovalForPosts: true,
          requireApprovalForPostsOnPlatforms: ['instagram', 'facebook'],
          requireApprovalForCampaignTypes: ['launch'],
        },
      ),
    ).toBeNull();
  });
});

describe('diffApprovalRules — single field change', () => {
  it('captures requireApprovalForPosts toggle', () => {
    const d = diffApprovalRules(empty, {
      ...empty,
      requireApprovalForPosts: true,
    });
    expect(d).not.toBeNull();
    expect(d!.requireApprovalForPostsChanged).toEqual({ from: false, to: true });
    expect(d!.addedPlatforms).toEqual([]);
    expect(d!.removedPlatforms).toEqual([]);
  });

  it('captures a platform addition', () => {
    const d = diffApprovalRules(empty, {
      ...empty,
      requireApprovalForPostsOnPlatforms: ['instagram'],
    });
    expect(d).not.toBeNull();
    expect(d!.addedPlatforms).toEqual(['instagram']);
    expect(d!.removedPlatforms).toEqual([]);
  });

  it('captures a platform removal', () => {
    const d = diffApprovalRules(
      { ...empty, requireApprovalForPostsOnPlatforms: ['instagram'] },
      empty,
    );
    expect(d).not.toBeNull();
    expect(d!.removedPlatforms).toEqual(['instagram']);
    expect(d!.addedPlatforms).toEqual([]);
  });

  it('captures a goal addition', () => {
    const d = diffApprovalRules(empty, {
      ...empty,
      requireApprovalForCampaignTypes: ['crisis'],
    });
    expect(d).not.toBeNull();
    expect(d!.addedGoals).toEqual(['crisis']);
  });
});

describe('diffApprovalRules — multiple field changes', () => {
  it('captures every channel of change in one diff', () => {
    const d = diffApprovalRules(
      {
        requireApprovalForPosts: false,
        requireApprovalForPostsOnPlatforms: ['facebook'],
        requireApprovalForCampaignTypes: ['launch'],
      },
      {
        requireApprovalForPosts: true,
        requireApprovalForPostsOnPlatforms: ['instagram', 'gbp'],
        requireApprovalForCampaignTypes: ['crisis'],
      },
    );
    expect(d).not.toBeNull();
    expect(d!.requireApprovalForPostsChanged).toEqual({ from: false, to: true });
    expect([...d!.addedPlatforms].sort()).toEqual(['gbp', 'instagram']);
    expect(d!.removedPlatforms).toEqual(['facebook']);
    expect(d!.addedGoals).toEqual(['crisis']);
    expect(d!.removedGoals).toEqual(['launch']);
  });
});
