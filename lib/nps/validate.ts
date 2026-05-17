import { z } from 'zod';

/**
 * Zod schemas for NPS Server Actions + public submit (Phase 9 /
 * Commit 32).
 *
 * Server boundary validation — defense in depth alongside the
 * TypeScript-level types. Public landing also re-validates server-side
 * via `submitNpsResponseSchema` even though the client form
 * type-checks each field; never trust client input.
 */

const channelSchema = z.enum(['email', 'whatsapp', 'sms_reserved']);

const triggerSchema = z.enum([
  'post_purchase',
  'post_resolution',
  'periodic',
  'manual',
]);

const statusSchema = z.enum(['draft', 'active', 'paused', 'archived']);

export const createNpsSurveySchema = z.object({
  brandId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  trigger: triggerSchema,
  channels: z.array(channelSchema).min(1),
  questionText: z.string().min(1).max(500),
  thankYouMessage: z.string().max(500).nullable().optional(),
  locale: z.enum(['es', 'en']).default('es'),
  status: statusSchema.default('draft'),
  minDaysBetweenSends: z.number().int().min(0).max(365).default(90),
});

export type CreateNpsSurveyInput = z.infer<typeof createNpsSurveySchema>;

export const updateNpsSurveySchema = createNpsSurveySchema.extend({
  id: z.string().uuid(),
});

export type UpdateNpsSurveyInput = z.infer<typeof updateNpsSurveySchema>;

export const sendNpsInvitationSchema = z.object({
  surveyId: z.string().uuid(),
  /**
   * Manual-trigger contacts. The Server Action enforces the
   * per-survey throttle and the channel must be enabled on the
   * survey.
   */
  contacts: z
    .array(
      z.object({
        contactIdentifier: z.string().min(1).max(320),
        contactName: z.string().max(120).nullable().optional(),
        channel: channelSchema,
        idempotencyKey: z.string().max(80).nullable().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export type SendNpsInvitationInput = z.infer<typeof sendNpsInvitationSchema>;

export const submitNpsResponseSchema = z.object({
  token: z.string().min(1).max(64),
  score: z.number().int().min(0).max(10),
  comment: z.string().max(4000).optional().nullable(),
});

export type SubmitNpsResponseInput = z.infer<typeof submitNpsResponseSchema>;

export const exportNpsCsvSchema = z.object({
  surveyId: z.string().uuid().nullable().optional(),
  period: z.enum(['7d', '30d', '90d']),
});

export type ExportNpsCsvInput = z.infer<typeof exportNpsCsvSchema>;
