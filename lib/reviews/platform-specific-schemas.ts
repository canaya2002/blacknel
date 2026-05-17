import { z } from 'zod';

/**
 * Phase 10 / Commit 38 · Ajuste 1 — per-platform Zod validation
 * for `reviews.platform_specific`.
 *
 * # Why these schemas exist
 *
 * `platform_specific` is jsonb at the DB layer (D-38-1 a) for
 * flexibility — but jsonb is type-unsafe at the TS layer and
 * easy to turn into a "Drupal sink" of arbitrary garbage. These
 * Zod schemas reintroduce structure: every platform declares
 * exactly which fields it allows, all optional, all typed.
 *
 * The dispatcher `validatePlatformSpecific(platform, payload)`
 * routes to the right schema. Callers should invoke it before
 * INSERT/UPDATE on `reviews` rows.
 *
 * # Render-only rule (mirrors `lib/db/schema/reviews.ts`)
 *
 * Fields here are visualization-only. None of them should leak
 * into WHERE clauses or queries. If a field becomes
 * query-relevant, promote it to a typed column via dedicated
 * migration AND remove from these schemas.
 */

export const YelpPlatformSpecificSchema = z
  .object({
    elite_reviewer: z.boolean().optional(),
    response_window_hours: z.number().int().min(0).max(720).optional(),
  })
  .strict();

export const TripadvisorPlatformSpecificSchema = z
  .object({
    traveler_choice: z.boolean().optional(),
    category_ratings: z
      .object({
        food: z.number().int().min(1).max(5).optional(),
        service: z.number().int().min(1).max(5).optional(),
        value: z.number().int().min(1).max(5).optional(),
        atmosphere: z.number().int().min(1).max(5).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TrustpilotPlatformSpecificSchema = z
  .object({
    verified_buyer: z.boolean().optional(),
    business_trust_score: z.number().min(0).max(5).optional(),
    invitation_based: z.boolean().optional(),
  })
  .strict();

/**
 * BBB is complaint-resolution, not review-based. The lifecycle
 * lives entirely in `platform_specific` (Ajuste 2).
 */
export const BbbPlatformSpecificSchema = z
  .object({
    complaint_type: z
      .enum(['product', 'service', 'billing', 'advertising', 'sales'])
      .optional(),
    complaint_status: z
      .enum(['pending', 'assigned', 'resolved', 'closed'])
      .optional(),
    case_id: z.string().min(1).max(40).optional(),
    resolution_summary: z.string().max(2000).nullable().optional(),
    filed_at: z.string().datetime().optional(),
  })
  .strict();

export const AvvoPlatformSpecificSchema = z
  .object({
    case_type: z
      .enum([
        'family_law',
        'criminal',
        'personal_injury',
        'estate_planning',
        'business',
        'immigration',
        'other',
      ])
      .optional(),
    client_testimonial: z.boolean().optional(),
    attorney_response_count: z.number().int().min(0).optional(),
  })
  .strict();

export type YelpPlatformSpecific = z.infer<typeof YelpPlatformSpecificSchema>;
export type TripadvisorPlatformSpecific = z.infer<
  typeof TripadvisorPlatformSpecificSchema
>;
export type TrustpilotPlatformSpecific = z.infer<
  typeof TrustpilotPlatformSpecificSchema
>;
export type BbbPlatformSpecific = z.infer<typeof BbbPlatformSpecificSchema>;
export type AvvoPlatformSpecific = z.infer<typeof AvvoPlatformSpecificSchema>;

/**
 * Dispatcher: validate `platform_specific` jsonb against the
 * schema for the given platform. Platforms NOT in this map
 * (Facebook, Instagram, Google, …) receive a passthrough — they
 * may carry NULL or any legacy shape from pre-C38 rows.
 *
 * @throws ZodError when validation fails. Callers handle via Result.
 */
export function validatePlatformSpecific(
  platform: string,
  payload: unknown,
): unknown {
  if (payload === null || payload === undefined) return null;
  switch (platform) {
    case 'yelp':
      return YelpPlatformSpecificSchema.parse(payload);
    case 'tripadvisor':
      return TripadvisorPlatformSpecificSchema.parse(payload);
    case 'trustpilot':
      return TrustpilotPlatformSpecificSchema.parse(payload);
    case 'bbb':
      return BbbPlatformSpecificSchema.parse(payload);
    case 'avvo':
      return AvvoPlatformSpecificSchema.parse(payload);
    default:
      // Unknown / pre-C38 platform — passthrough. Phase 11 may
      // tighten by adding schemas for legacy platforms.
      return payload;
  }
}
