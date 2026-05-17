import { z } from 'zod';

/**
 * Validators for WhatsApp Business Server Actions (Phase 9 /
 * Commit 31).
 */

// Connect — manual dialog (Fase 11 swap to Meta OAuth).
export const connectWhatsappAccountSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^\+?[0-9 \-()]+$/, 'Formato de teléfono inválido'),
  phoneNumberId: z.string().trim().min(1).max(120),
  businessAccountId: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(120).nullable().optional(),
});

export type ConnectWhatsappAccountInput = z.infer<
  typeof connectWhatsappAccountSchema
>;

// Template variable: {position: 1, label: 'first_name'}.
const variableSchema = z.object({
  position: z.number().int().min(1).max(20),
  label: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/i, 'Solo letras, dígitos y _'),
});

// Create template — submits to Meta (mocked).
export const createTemplateSchema = z.object({
  whatsappAccountId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Solo minúsculas, dígitos y _ (Meta uniqueness rule)',
    ),
  category: z.enum(['utility', 'marketing', 'authentication']),
  language: z
    .string()
    .trim()
    .min(2)
    .max(8)
    .regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'Código ISO (es, en, es_MX, …)'),
  body: z.string().trim().min(1).max(1024),
  variables: z.array(variableSchema).max(20).optional(),
});

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

// Send template — composer entrypoint.
export const sendTemplateSchema = z.object({
  threadId: z.string().uuid(),
  templateId: z.string().uuid(),
  variables: z.record(z.string(), z.string()).default({}),
});

export type SendTemplateInput = z.infer<typeof sendTemplateSchema>;
