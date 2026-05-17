import { describe, expect, it } from 'vitest';

import {
  approvalRulesSchema,
  brandVoiceFormSchema,
  normalizeEmojis,
  normalizeWords,
  parseCsv,
} from '../../lib/brand-voice/validate';

const baseValidForm = {
  name: 'Friendly',
  tone: 'cordial',
  style: 'corto y directo',
  forbiddenWords: ['Garantizado'],
  preferredWords: ['cuidado'],
  allowedEmojis: ['✨'],
  languages: ['es'] as Array<'es' | 'en' | 'pt' | 'fr'>,
  approvalRules: {
    requireApprovalForPosts: false,
    requireApprovalForPostsOnPlatforms: [],
    requireApprovalForCampaignTypes: [],
  },
};

describe('brandVoiceFormSchema — happy path', () => {
  it('parses a fully-populated valid form', () => {
    const r = brandVoiceFormSchema.safeParse(baseValidForm);
    expect(r.success).toBe(true);
  });

  it('accepts empty word/emoji arrays (default)', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      forbiddenWords: [],
      preferredWords: [],
      allowedEmojis: [],
    });
    expect(r.success).toBe(true);
  });
});

describe('brandVoiceFormSchema — name / tone / style limits', () => {
  it('rejects name >100 chars', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      name: 'a'.repeat(101),
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty name', () => {
    const r = brandVoiceFormSchema.safeParse({ ...baseValidForm, name: '' });
    expect(r.success).toBe(false);
  });
  it('rejects tone >200 chars', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      tone: 'a'.repeat(201),
    });
    expect(r.success).toBe(false);
  });
  it('rejects style >500 chars', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      style: 'a'.repeat(501),
    });
    expect(r.success).toBe(false);
  });
});

describe('brandVoiceFormSchema — word arrays', () => {
  it('rejects >100 forbiddenWords', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      forbiddenWords: Array.from({ length: 101 }, (_, i) => `w${i}`),
    });
    expect(r.success).toBe(false);
  });

  it('rejects a forbidden word >50 chars', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      forbiddenWords: ['a'.repeat(51)],
    });
    expect(r.success).toBe(false);
  });

  it('accepts up to 100 entries', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      forbiddenWords: Array.from({ length: 100 }, (_, i) => `w${i}`),
    });
    expect(r.success).toBe(true);
  });
});

describe('brandVoiceFormSchema — emoji array', () => {
  it('rejects >50 emojis', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      allowedEmojis: Array.from({ length: 51 }, () => '✨'),
    });
    expect(r.success).toBe(false);
  });

  it('rejects emoji >4 chars', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      allowedEmojis: ['toolong'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-emoji string', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      allowedEmojis: ['abc'],
    });
    expect(r.success).toBe(false);
  });

  it('accepts an emoji with modifiers (multi-codepoint within 4 chars)', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      allowedEmojis: ['🌟'],
    });
    expect(r.success).toBe(true);
  });
});

describe('brandVoiceFormSchema — languages', () => {
  it('rejects empty languages', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      languages: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown language code', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      languages: ['de'],
    });
    expect(r.success).toBe(false);
  });

  it('rejects >4 languages', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      languages: ['es', 'en', 'pt', 'fr', 'es'],
    });
    expect(r.success).toBe(false);
  });

  it('accepts the 4 supported codes', () => {
    const r = brandVoiceFormSchema.safeParse({
      ...baseValidForm,
      languages: ['es', 'en', 'pt', 'fr'] as Array<'es' | 'en' | 'pt' | 'fr'>,
    });
    expect(r.success).toBe(true);
  });
});

describe('approvalRulesSchema', () => {
  it('rejects >8 platforms', () => {
    const r = approvalRulesSchema.safeParse({
      requireApprovalForPosts: false,
      requireApprovalForPostsOnPlatforms: [
        'facebook',
        'instagram',
        'gbp',
        'whatsapp',
        'tiktok',
        'linkedin',
        'x',
        'youtube',
        'pinterest',
      ],
      requireApprovalForCampaignTypes: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown platform code', () => {
    const r = approvalRulesSchema.safeParse({
      requireApprovalForPosts: false,
      requireApprovalForPostsOnPlatforms: ['myspace'],
      requireApprovalForCampaignTypes: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects >12 campaign goals', () => {
    const r = approvalRulesSchema.safeParse({
      requireApprovalForPosts: false,
      requireApprovalForPostsOnPlatforms: [],
      requireApprovalForCampaignTypes: Array.from({ length: 13 }, () => 'launch'),
    });
    expect(r.success).toBe(false);
  });
});

describe('normalizeWords', () => {
  it('lowercases + dedupes + drops empties', () => {
    const out = normalizeWords(['Refund', 'refund', 'LAWYER', '', ' '.trim()]);
    expect(out).toEqual(['refund', 'lawyer']);
  });
});

describe('normalizeEmojis', () => {
  it('trims + dedupes preserving case', () => {
    const out = normalizeEmojis([' ✨ ', '✨', '🌟']);
    expect(out).toEqual(['✨', '🌟']);
  });
});

describe('parseCsv', () => {
  it('splits + trims + drops empties', () => {
    const out = parseCsv(' a , b ,, c, ');
    expect(out).toEqual(['a', 'b', 'c']);
  });
});
