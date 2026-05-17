'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import { WHATSAPP_CAPABILITIES } from '@/lib/connectors/whatsapp';
import {
  sendTemplate as mockSendTemplate,
  submitTemplate as mockSubmitTemplate,
} from '@/lib/connectors/whatsapp/templates-mock';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  connectedAccounts,
  inboxMessages,
  inboxThreads,
  whatsappAccounts,
  whatsappTemplates,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';
import {
  connectWhatsappAccountSchema,
  createTemplateSchema,
  sendTemplateSchema,
} from '@/lib/whatsapp/validate';

/**
 * WhatsApp Business Server Actions (Phase 9 / Commit 31).
 *
 *   - `connectWhatsappAccountAction`  — manual dialog inserts
 *     `connected_accounts` + `whatsapp_accounts` rows. Gated
 *     `integrations:manage` + Growth plan via `requirePlanFeature`.
 *   - `createTemplateAction`          — inserts a template, calls
 *     `submitTemplate` mock to decide approved/rejected, persists
 *     status. Gated `whatsapp:manage_templates`.
 *   - `sendTemplateAction`            — inbox-composer integration.
 *     Reuses `inbox:reply` permission. Persists an outbound
 *     `inbox_messages` row with `whatsapp_template_id` FK set
 *     (the charter-touch column from Commit 31).
 *
 * Auditable surfaces:
 *   - `whatsapp_account.connected`
 *   - `whatsapp_template.{submitted,approved,rejected}`
 *   - `whatsapp_template.sent` (per outbound)
 */

// ---------------------------------------------------------------------------
// connectWhatsappAccountAction
// ---------------------------------------------------------------------------

export async function connectWhatsappAccountAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ whatsappAccountId: string; connectedAccountId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'whatsapp_business');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = connectWhatsappAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de conexión inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;
  const displayName = data.displayName ?? null;

  // Upsert path: same (org, phone_number) → reuse the existing
  // whatsapp_accounts row and flip its parent connected_accounts
  // back to 'connected'. Otherwise insert both.
  const existing = await dbAs<
    Array<{
      whatsappAccountId: string;
      connectedAccountId: string;
    }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        whatsappAccountId: whatsappAccounts.id,
        connectedAccountId: whatsappAccounts.connectedAccountId,
      })
      .from(whatsappAccounts)
      .where(
        and(
          eq(whatsappAccounts.organizationId, session.orgId),
          eq(whatsappAccounts.phoneNumber, data.phoneNumber),
        ),
      )
      .limit(1),
  );

  if (existing.length > 0) {
    const row = existing[0]!;
    await dbAs({ orgId: session.orgId, userId: session.userId }, async (tx) => {
      await tx
        .update(connectedAccounts)
        .set({
          status: 'connected',
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(connectedAccounts.id, row.connectedAccountId));
      await tx
        .update(whatsappAccounts)
        .set({
          phoneNumberId: data.phoneNumberId,
          businessAccountId: data.businessAccountId,
          displayName,
          updatedAt: new Date(),
        })
        .where(eq(whatsappAccounts.id, row.whatsappAccountId));
    });

    try {
      await dbAdmin((tx) =>
        tx.insert(auditEvents).values({
          organizationId: session.orgId,
          userId: session.userId,
          actorType: 'user',
          action: 'whatsapp_account.reconnected',
          entityType: 'whatsapp_account',
          entityId: row.whatsappAccountId,
          after: { phoneNumber: data.phoneNumber, displayName },
          riskLevel: 'low',
        }),
      );
    } catch (cause) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Failed to audit whatsapp_account.reconnected.',
        { cause },
      );
    }
    revalidatePath('/integrations');
    return ok({
      whatsappAccountId: row.whatsappAccountId,
      connectedAccountId: row.connectedAccountId,
    });
  }

  // Fresh insert path.
  const result = await dbAs<{
    connectedAccountId: string;
    whatsappAccountId: string;
  }>({ orgId: session.orgId, userId: session.userId }, async (tx) => {
    const connectedRows = await tx
      .insert(connectedAccounts)
      .values({
        organizationId: session.orgId,
        platform: 'whatsapp',
        externalAccountId: data.phoneNumberId,
        displayName: displayName ?? data.phoneNumber,
        status: 'connected',
        lastSyncAt: new Date(),
        capabilities: WHATSAPP_CAPABILITIES.supported,
        oauthTokensEncrypted: {},
      })
      .returning({ id: connectedAccounts.id });
    const connectedAccountId = connectedRows[0]!.id;

    const waRows = await tx
      .insert(whatsappAccounts)
      .values({
        organizationId: session.orgId,
        connectedAccountId,
        phoneNumber: data.phoneNumber,
        phoneNumberId: data.phoneNumberId,
        businessAccountId: data.businessAccountId,
        ...(displayName ? { displayName } : {}),
      })
      .returning({ id: whatsappAccounts.id });
    const whatsappAccountId = waRows[0]!.id;

    return { connectedAccountId, whatsappAccountId };
  });

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'whatsapp_account.connected',
        entityType: 'whatsapp_account',
        entityId: result.whatsappAccountId,
        after: {
          phoneNumber: data.phoneNumber,
          businessAccountId: data.businessAccountId,
          displayName,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit whatsapp_account.connected.',
      { cause },
    );
  }

  revalidatePath('/integrations');
  return ok(result);
}

// ---------------------------------------------------------------------------
// createTemplateAction
// ---------------------------------------------------------------------------

export async function createTemplateAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ templateId: string; status: 'approved' | 'rejected' }>> {
  const session = await requireUser();
  authorize(session.role, 'whatsapp:manage_templates');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'whatsapp_business');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Template inválido.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Mock-submit synchronously decides approved/rejected. Real
  // Meta flow is async (pending → … resolves later).
  const verdict = mockSubmitTemplate({ body: data.body });
  const now = new Date();

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(whatsappTemplates)
        .values({
          organizationId: session.orgId,
          whatsappAccountId: data.whatsappAccountId,
          name: data.name,
          category: data.category,
          language: data.language,
          body: data.body,
          variables: data.variables ?? [],
          status: verdict.status,
          ...(verdict.rejectedReason
            ? { rejectedReason: verdict.rejectedReason }
            : {}),
          submittedAt: now,
          ...(verdict.status === 'approved' ? { approvedAt: now } : {}),
          ...(verdict.status === 'rejected' ? { rejectedAt: now } : {}),
        })
        .returning({ id: whatsappTemplates.id }),
  );
  const templateId = inserted[0]?.id;
  if (!templateId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el template.');
  }

  // Two audit rows: the submit + the verdict. Matches the
  // dual-state lifecycle so the audit trail tells the same
  // story Meta's webhook would.
  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'whatsapp_template.submitted',
        entityType: 'whatsapp_template',
        entityId: templateId,
        after: { name: data.name, category: data.category },
        riskLevel: 'low',
      }),
    );
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: null,
        actorType: 'system',
        action: `whatsapp_template.${verdict.status}`,
        entityType: 'whatsapp_template',
        entityId: templateId,
        after: {
          status: verdict.status,
          reason: verdict.rejectedReason ?? undefined,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit whatsapp_template.* events.',
      { cause, meta: { templateId } },
    );
  }

  revalidatePath('/integrations');
  return ok({ templateId, status: verdict.status });
}

// ---------------------------------------------------------------------------
// sendTemplateAction
// ---------------------------------------------------------------------------

export async function sendTemplateAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ messageId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:reply');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'whatsapp_business');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = sendTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Envío inválido.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const { threadId, templateId, variables } = parsed.data;

  // Load thread + template (verify both belong to org, both are
  // WhatsApp, template is approved).
  const ctx = await dbAs<
    Array<{
      threadPlatform: string;
      whatsappAccountId: string;
      templateName: string;
      templateLanguage: string;
      templateStatus: 'pending' | 'approved' | 'rejected';
      recipientPhone: string | null;
    }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        threadPlatform: inboxThreads.platform,
        whatsappAccountId: whatsappTemplates.whatsappAccountId,
        templateName: whatsappTemplates.name,
        templateLanguage: whatsappTemplates.language,
        templateStatus: whatsappTemplates.status,
        recipientPhone: inboxThreads.externalThreadId,
      })
      .from(inboxThreads)
      .innerJoin(
        whatsappTemplates,
        eq(whatsappTemplates.id, templateId),
      )
      .where(
        and(
          eq(inboxThreads.id, threadId),
          eq(inboxThreads.organizationId, session.orgId),
          eq(whatsappTemplates.organizationId, session.orgId),
        ),
      )
      .limit(1),
  );
  if (ctx.length === 0) {
    return err('NOT_FOUND', 'Thread o template no encontrado.');
  }
  const r = ctx[0]!;
  if (r.threadPlatform !== 'whatsapp') {
    return err(
      'VALIDATION_ERROR',
      'Templates solo se pueden enviar a threads de WhatsApp.',
    );
  }
  if (r.templateStatus !== 'approved') {
    return err(
      'CONFLICT',
      `El template está ${r.templateStatus}. Solo los templates approved se pueden enviar.`,
    );
  }

  const now = new Date();
  const sendResult = mockSendTemplate(
    {
      whatsappAccountId: r.whatsappAccountId,
      recipientPhone: r.recipientPhone ?? '',
      templateName: r.templateName,
      templateLanguage: r.templateLanguage,
      variables,
    },
    now,
  );

  // Persist as outbound inbox_messages with whatsapp_template_id
  // set (the charter-touch column from Commit 31). The
  // `idempotency_key` defaults to the synthetic external id so
  // re-runs of the same send within the same second dedupe.
  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(inboxMessages)
        .values({
          organizationId: session.orgId,
          threadId,
          direction: 'outbound',
          authorType: 'user',
          authorId: session.userId,
          body: sendResult.renderedBody,
          sentAt: now,
          externalMessageId: sendResult.externalMessageId,
          idempotencyKey: sendResult.externalMessageId,
          whatsappTemplateId: templateId,
        })
        .returning({ id: inboxMessages.id }),
  );
  const messageId = inserted[0]?.id;
  if (!messageId) {
    return err('INTERNAL_ERROR', 'No se pudo guardar el mensaje.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'whatsapp_template.sent',
        entityType: 'inbox_message',
        entityId: messageId,
        after: {
          templateId,
          threadId,
          externalMessageId: sendResult.externalMessageId,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit whatsapp_template.sent.',
      { cause, meta: { messageId } },
    );
  }

  revalidatePath(`/inbox/${threadId}`);
  return ok({ messageId });
}
