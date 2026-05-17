import { z } from 'zod';

const platformSchema = z.enum([
  'facebook',
  'instagram',
  'x',
  'reddit',
  'tiktok',
  'linkedin',
]);

export const addCompetitorSchema = z.object({
  brandId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(120),
  platforms: z.array(platformSchema).min(1).max(6),
  handles: z.record(platformSchema, z.string().min(1).max(80)).optional(),
});

export type AddCompetitorInput = z.infer<typeof addCompetitorSchema>;

export const removeCompetitorSchema = z.object({
  competitorId: z.string().uuid(),
});
