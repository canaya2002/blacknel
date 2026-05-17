import { describe, expect, it } from 'vitest';

import { PROMPT_REGISTRY } from '../../lib/ai/prompts';
import type { AiSkillKey } from '../../lib/ai/types';

const ALL_SKILLS: ReadonlyArray<AiSkillKey> = [
  'compliance',
  'caption',
  'review_response',
  'language_detect',
  'sentiment',
  'intent',
  'crisis',
  'thread_summary',
  'review_summary',
];

describe('PROMPT_REGISTRY — every skill registered', () => {
  for (const skill of ALL_SKILLS) {
    it(`has an entry for '${skill}'`, () => {
      const entry = PROMPT_REGISTRY[skill];
      expect(entry).toBeDefined();
      expect(entry.skill).toBe(skill);
      expect(entry.version).toMatch(/^v\d+$/);
      expect(entry.systemPrompt.length).toBeGreaterThan(200);
      expect(entry.userTemplate.length).toBeGreaterThan(20);
    });
  }
});

describe('PROMPT_REGISTRY — model rationale', () => {
  it('crisis uses Opus (subtle pattern detection)', () => {
    expect(PROMPT_REGISTRY.crisis.defaultModel).toBe('claude-opus-4-7');
  });
  it('all non-crisis skills default to Haiku (cost-first rule)', () => {
    for (const skill of ALL_SKILLS) {
      if (skill === 'crisis') continue;
      expect(PROMPT_REGISTRY[skill].defaultModel).toBe('claude-haiku-4-5');
    }
  });
});

describe('PROMPT_REGISTRY — system prompt sanity', () => {
  it('every system prompt instructs "Return JSON only" or equivalent', () => {
    for (const skill of ALL_SKILLS) {
      const sp = PROMPT_REGISTRY[skill].systemPrompt.toLowerCase();
      expect(sp).toMatch(/json/);
    }
  });
});

describe('PROMPT_REGISTRY — user template placeholder hygiene', () => {
  // User templates may carry {placeholder} tokens — that's the
  // expected substitution surface. But each skill module is
  // responsible for substituting EVERY token before passing to
  // the adapter. Here we just sanity check that the templates
  // don't accidentally contain an obviously-broken token.
  it('no template contains an empty {} placeholder', () => {
    for (const skill of ALL_SKILLS) {
      const t = PROMPT_REGISTRY[skill].userTemplate;
      expect(t).not.toMatch(/\{\s*\}/);
    }
  });
});
