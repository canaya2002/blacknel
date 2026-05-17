import { z } from 'zod';

/**
 * Zod schemas for the Advanced Audit Server Actions (Phase 10 /
 * Commit 37).
 */

export const exportAuditCsvSchema = z.object({
  sinceDays: z.number().int().min(1).max(365),
  actionPrefix: z.string().max(80).nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  /** Mass=true required for >1000 row exports. Critical #6. */
  mass: z.boolean().default(false),
});

export type ExportAuditCsvInput = z.infer<typeof exportAuditCsvSchema>;

export const createRetentionPolicySchema = z.object({
  appliesTo: z
    .string()
    .min(1)
    .max(120)
    .regex(/^(all|[a-z_]+(\.[a-z_]+)*(\.\*)?)$/, {
      message:
        "Pattern debe ser 'all', un nombre de action exacto (ej 'billing.charge'), o un prefix (ej 'billing.*').",
    }),
  retentionDays: z.number().int().min(1).max(3650),
});

export type CreateRetentionPolicyInput = z.infer<
  typeof createRetentionPolicySchema
>;

export const removeRetentionPolicySchema = z.object({
  policyId: z.string().uuid(),
});

/**
 * Ajuste 1 — dismissal must carry a reason ≥10 chars.
 */
export const dismissAnomalySchema = z.object({
  anomalyId: z.string().uuid(),
  action: z.enum(['dismiss', 'accept']),
  reason: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(10).max(500)),
});

export type DismissAnomalyInput = z.infer<typeof dismissAnomalySchema>;
