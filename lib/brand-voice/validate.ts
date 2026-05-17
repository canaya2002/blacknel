import { z } from 'zod';

import { CAMPAIGN_GOALS } from '../campaigns/validate';
import { PLATFORMS } from '../connectors/base';

/**
 * Strict validation for brand voice editor (Commit 26 / Ajuste 1).
 *
 * Every input that lands in `brand_voices.*` or
 * `brand_voices.metadata.approvalRules` runs through these Zod
 * schemas BEFORE the Server Action issues the INSERT/UPDATE. The
 * rules exist to keep `metadata` jsonb from accumulating garbage
 * (rogue keys, unbounded arrays, non-emoji strings in
 * `allowedEmojis`, etc.) — the read paths assume well-formed
 * data, so the write boundary is the place to enforce.
 *
 * **Normalization (NOT validation):**
 *
 *   - `forbiddenWords` / `preferredWords` lowercased + deduped.
 *   - All string entries `trim()`-ed before length checks.
 *   - Empty entries dropped from arrays after trim.
 *
 * Normalization happens AFTER Zod parse but BEFORE persist; the
 * `normalize*` helpers below are reused by the Server Actions.
 */

const SUPPORTED_LANGUAGES = ['es', 'en', 'pt', 'fr'] as const;

const NAME_MIN = 1;
const NAME_MAX = 100;
const TONE_MIN = 1;
const TONE_MAX = 200;
const STYLE_MIN = 1;
const STYLE_MAX = 500;
const WORDS_MAX_ENTRIES = 100;
const WORD_MIN_LEN = 1;
const WORD_MAX_LEN = 50;
const EMOJIS_MAX_ENTRIES = 50;
const EMOJI_MAX_LEN = 4;

// Validates that the string starts with an emoji codepoint.
// Unicode property escapes (`\p{Emoji}`) require the `u` flag.
// Modifier sequences (skin tones, ZWJ joins) are captured by the
// 4-char cap.
const EMOJI_RE = /^\p{Emoji}/u;

const wordSchema = z
  .string()
  .trim()
  .min(WORD_MIN_LEN, 'Cada entrada debe tener al menos 1 carácter.')
  .max(WORD_MAX_LEN, `Cada entrada no puede exceder ${WORD_MAX_LEN} caracteres.`);

const emojiSchema = z
  .string()
  .trim()
  .min(1, 'El emoji no puede ser vacío.')
  .max(EMOJI_MAX_LEN, `El emoji no puede exceder ${EMOJI_MAX_LEN} caracteres.`)
  .refine((s) => EMOJI_RE.test(s), {
    message: 'Esa entrada no parece un emoji válido.',
  });

const languageSchema = z.enum(SUPPORTED_LANGUAGES);

const platformSchema = z.enum(PLATFORMS);

const goalSchema = z.enum(
  CAMPAIGN_GOALS as ReadonlyArray<string> as readonly [string, ...string[]],
);

// ---------------------------------------------------------------------------
// metadata.approvalRules
// ---------------------------------------------------------------------------

export const approvalRulesSchema = z
  .object({
    requireApprovalForPosts: z.boolean().default(false),
    requireApprovalForPostsOnPlatforms: z
      .array(platformSchema)
      .max(8, 'Máximo 8 plataformas.')
      .default([]),
    requireApprovalForCampaignTypes: z
      .array(goalSchema)
      .max(12, 'Máximo 12 goals.')
      .default([]),
  })
  .strict();

export type ApprovalRules = z.infer<typeof approvalRulesSchema>;

// ---------------------------------------------------------------------------
// Brand voice — create + update
// ---------------------------------------------------------------------------

export const brandVoiceFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(NAME_MIN, 'El nombre es requerido.')
      .max(NAME_MAX, `Máximo ${NAME_MAX} caracteres.`),
    tone: z
      .string()
      .trim()
      .min(TONE_MIN, 'El tono es requerido.')
      .max(TONE_MAX, `Máximo ${TONE_MAX} caracteres.`),
    style: z
      .string()
      .trim()
      .min(STYLE_MIN, 'El estilo es requerido.')
      .max(STYLE_MAX, `Máximo ${STYLE_MAX} caracteres.`),
    forbiddenWords: z
      .array(wordSchema)
      .max(
        WORDS_MAX_ENTRIES,
        `Máximo ${WORDS_MAX_ENTRIES} entradas.`,
      )
      .default([]),
    preferredWords: z
      .array(wordSchema)
      .max(
        WORDS_MAX_ENTRIES,
        `Máximo ${WORDS_MAX_ENTRIES} entradas.`,
      )
      .default([]),
    allowedEmojis: z
      .array(emojiSchema)
      .max(EMOJIS_MAX_ENTRIES, `Máximo ${EMOJIS_MAX_ENTRIES} emojis.`)
      .default([]),
    languages: z
      .array(languageSchema)
      .min(1, 'Selecciona al menos un idioma.')
      .max(4, 'Máximo 4 idiomas.'),
    approvalRules: approvalRulesSchema.default({
      requireApprovalForPosts: false,
      requireApprovalForPostsOnPlatforms: [],
      requireApprovalForCampaignTypes: [],
    }),
  })
  .strict();

export type BrandVoiceFormInput = z.infer<typeof brandVoiceFormSchema>;

// Server-action wrappers — add the brand pointer for create, the
// brand-voice id for update.
export const createBrandVoiceSchema = z.object({
  brandId: z.string().uuid(),
  form: brandVoiceFormSchema,
});
export type CreateBrandVoiceInput = z.infer<typeof createBrandVoiceSchema>;

export const updateBrandVoiceSchema = z.object({
  brandVoiceId: z.string().uuid(),
  form: brandVoiceFormSchema,
});
export type UpdateBrandVoiceInput = z.infer<typeof updateBrandVoiceSchema>;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Lowercases + dedupes a list of "word" strings. The match
 * keyword logic in `lib/ai/compliance-stub.ts` lower-cases at
 * search time, so storing lowercased entries keeps the on-disk
 * representation aligned with the runtime semantics.
 *
 * Empty entries (after trim) are dropped — these come from
 * trailing commas in CSV input.
 */
export function normalizeWords(input: ReadonlyArray<string>): ReadonlyArray<string> {
  const out = new Set<string>();
  for (const raw of input) {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed.length === 0) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

/**
 * Emoji dedup. Trim + uniq. Case is preserved (emojis are
 * caseless but variation selectors matter).
 */
export function normalizeEmojis(input: ReadonlyArray<string>): ReadonlyArray<string> {
  const out = new Set<string>();
  for (const raw of input) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

/**
 * CSV → array. Splits on commas, trims each entry, drops empties.
 * Used by the form to convert the textareas into structured input
 * before the Zod parse.
 */
export function parseCsv(input: string): ReadonlyArray<string> {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
