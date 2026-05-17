import { z } from 'zod';

/**
 * Zod schemas for the listening surface (Phase 9 / Commit 33).
 */

const platformSchema = z.enum([
  'facebook',
  'instagram',
  'x',
  'reddit',
  'tiktok',
  'linkedin',
]);

export const addTrackedTermSchema = z.object({
  brandId: z.string().uuid().nullable().optional(),
  term: z.string().min(1).max(120),
  termKind: z.enum(['keyword', 'hashtag', 'handle']),
  platforms: z.array(platformSchema).min(1).max(6),
});

export type AddTrackedTermInput = z.infer<typeof addTrackedTermSchema>;

export const removeTrackedTermSchema = z.object({
  termId: z.string().uuid(),
});

export const triageMentionSchema = z.object({
  mentionId: z.string().uuid(),
  action: z.enum(['archive', 'mark_lead', 'unmark_lead', 'assign_to_thread']),
});

export type TriageMentionInput = z.infer<typeof triageMentionSchema>;

export const exportListeningCsvSchema = z.object({
  period: z.enum(['7d', '30d', '90d']),
  status: z
    .enum(['new', 'triaged', 'archived', 'converted', 'all'])
    .default('all'),
  brandId: z.string().uuid().nullable().optional(),
});

export type ExportListeningCsvInput = z.infer<
  typeof exportListeningCsvSchema
>;
