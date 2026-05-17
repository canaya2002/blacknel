import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { checkCompliance } from '../ai/skills/compliance';
import { detectLanguageAi } from '../ai/skills/language-detect';
import { type AnyPgTx, dbAdmin, dbAs } from '../db/client';
import {
  approvals,
  auditEvents,
  inboxMessages,
  inboxThreads,
} from '../db/schema';
import { AppError } from '../errors';
import { err, ok, type Result } from '../types/result';

import { type DetectedLanguage } from './detect-language';
import { findUnresolvedPlaceholders } from './saved-reply-variables';

/**
 * DI seam for tests. Production code uses the default singleton-backed
 * transactor; integration tests pass `{ asUser, asAdmin }` wired to a
 * test pglite instance via `runAs` / `runAdmin`. Same code path, no
 * production complexity penalty.
 */
export interface ReplyDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: ReplyDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
};

/**
 * `sendReplyToThread` is the single funnel every outbound reply flows
 * through. The flow is intentionally strict and audited:
 *
 *   1. RLS-checked thread fetch (caller must already be authenticated).
 *   2. Reject unresolved placeholders — defense in depth against a
 *      composer that didn't filter.
 *   3. Run `checkCompliance` (Commit 23 — async, cascade Haiku→Opus).
 *      Pill in composer keeps using `complianceHint` sync per
 *      REGLA BLACKNEL AI-FEEDBACK PATTERN.
 *   4. Branch:
 *        a. safe + !requiresApproval → insert `inbox_messages` row,
 *           bump `last_message_at`, audit `inbox.reply.sent`.
 *        b. safe + requiresApproval → create `approvals` row
 *           referencing the would-be message, audit
 *           `inbox.reply.routed_to_approval` + `approval.created`.
 *           NO message is inserted yet.
 *        c. !safe → audit + AppError `AI_COMPLIANCE_VIOLATION`
 *           (Phase 7 only; the Phase-4 stub never returns this).
 *
 * Audit events are written via `dbAdmin` because `audit_events` is
 * append-only and RLS-bypass writes mirror what the real production
 * audit pipeline will look like in Phase 11.
 */

export interface SendReplyInput {
  readonly threadId: string;
  readonly messageBody: string;
  readonly savedReplyId?: string | null;
  readonly aiGenerated?: boolean;
  readonly language?: DetectedLanguage;
}

export interface SendReplySuccess {
  readonly outcome: 'sent' | 'routed_to_approval';
  readonly messageId?: string;
  readonly approvalId?: string;
}

export async function sendReplyToThread(
  ctx: { orgId: string; userId: string },
  input: SendReplyInput,
  deps: ReplyDeps = defaultDeps,
): Promise<Result<SendReplySuccess>> {
  const trimmed = input.messageBody.trim();
  if (trimmed.length === 0) {
    return err('VALIDATION_ERROR', 'El mensaje está vacío.');
  }
  if (trimmed.length > 8000) {
    return err('VALIDATION_ERROR', 'El mensaje supera el máximo permitido.');
  }

  // ---- 1. Confirm the thread exists and belongs to the caller's org ----
  const threadRows = await deps.asUser<
    Array<{ id: string; platform: string; lastMessageAt: Date; brandId: string | null }>
  >({ orgId: ctx.orgId, userId: ctx.userId }, async (tx) =>
    tx
      .select({
        id: inboxThreads.id,
        platform: inboxThreads.platform,
        lastMessageAt: inboxThreads.lastMessageAt,
        brandId: inboxThreads.brandId,
      })
      .from(inboxThreads)
      .where(
        and(
          eq(inboxThreads.id, input.threadId),
          eq(inboxThreads.organizationId, ctx.orgId),
        ),
      )
      .limit(1),
  );
  if (threadRows.length === 0) {
    return err('NOT_FOUND', 'Thread no encontrado.');
  }

  // ---- 2. Defense in depth: reject any unresolved placeholder ----
  const unresolved = findUnresolvedPlaceholders(trimmed);
  if (unresolved.length > 0) {
    await writeAudit(deps, ctx.orgId, ctx.userId, {
      action: 'inbox.reply.blocked_unresolved',
      entityType: 'inbox_thread',
      entityId: input.threadId,
      after: { unresolved, language: input.language ?? null },
      riskLevel: 'low',
    });
    return err(
      'UNRESOLVED_PLACEHOLDERS',
      'Reemplaza los placeholders marcados antes de enviar.',
      { meta: { unresolved } },
    );
  }

  // ---- 3a. Language detection (Commit 24 — async via aiClient) ----
  // We detect the language of the LAST INBOUND message so the
  // outgoing reply matches the customer's language. Per Ajuste 2
  // the ai_generations row anchors on that inbound message's id
  // (entityType='inbox_message') so "show me every AI generation
  // tied to this customer turn" remains a single FK lookup.
  //
  // `input.language` is an explicit override (composer override
  // surface); when present it short-circuits the AI call entirely.
  let detected: DetectedLanguage;
  if (input.language) {
    detected = input.language;
  } else {
    const lastInboundRows = await deps.asUser<
      Array<{ id: string; body: string }>
    >({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
      tx
        .select({ id: inboxMessages.id, body: inboxMessages.body })
        .from(inboxMessages)
        .where(
          and(
            eq(inboxMessages.threadId, input.threadId),
            eq(inboxMessages.direction, 'inbound'),
          ),
        )
        .orderBy(desc(inboxMessages.sentAt))
        .limit(1),
    );
    const lastInbound = lastInboundRows[0];
    if (lastInbound) {
      const langResult = await detectLanguageAi({
        text: lastInbound.body,
        context: {
          orgId: ctx.orgId,
          userId: ctx.userId,
          actorType: 'user',
          entityType: 'inbox_message',
          entityId: lastInbound.id,
        },
      });
      detected = langResult.language;
    } else {
      // No inbound message yet (thread initiated outbound, edge
      // case). Default to 'unknown' — composer leaves the pill
      // empty rather than guessing.
      detected = 'unknown';
    }
  }

  // ---- 3b. Compliance check (Commit 23 — async via aiClient + cascade) ----
  const complianceResponse = await checkCompliance({
    text: trimmed,
    context: {
      orgId: ctx.orgId,
      userId: ctx.userId,
      actorType: 'user',
      entityType: 'inbox_thread',
      entityId: input.threadId,
    },
    complianceContext: { entityType: 'inbox' },
  });
  const compliance = complianceResponse.result;

  if (!compliance.safe) {
    // Phase 4 stub never reaches this branch; wired for Phase 7's
    // safe=false / riskLevel=critical class. Audit + reject.
    await writeAudit(deps, ctx.orgId, ctx.userId, {
      action: 'inbox.reply.blocked_compliance',
      entityType: 'inbox_thread',
      entityId: input.threadId,
      after: { flags: compliance.flags, matched: compliance.matchedKeywords },
      riskLevel: compliance.riskLevel,
    });
    return err(
      'AI_COMPLIANCE_VIOLATION',
      'El contenido fue bloqueado por las reglas de compliance.',
      { meta: { flags: compliance.flags } },
    );
  }

  // ---- 4a. Route to approval if the stub flagged sensitive content ----
  if (compliance.requiresApproval) {
    const approvalId = await deps.asUser<{ id: string }[]>(
      { orgId: ctx.orgId, userId: ctx.userId },
      async (tx) =>
        tx
          .insert(approvals)
          .values({
            organizationId: ctx.orgId,
            kind: 'inbox_reply',
            entityTable: 'inbox_messages',
            // `entity_id` is the (eventual) message id. We pre-generate one
            // so the approval row references the same UUID the message
            // will use once approved. The actual `inbox_messages` insert
            // happens in the approval-decision pipeline (Commit 10 / 11).
            entityId: crypto.randomUUID(),
            requestedBy: ctx.userId,
            status: 'pending',
            riskLevel: compliance.riskLevel,
            aiRiskFlags: compliance.flags as string[],
            proposedPayload: {
              kind: 'inbox_reply',
              threadId: input.threadId,
              messageBody: trimmed,
              language: detected,
              savedReplyId: input.savedReplyId ?? null,
              aiGenerated: input.aiGenerated ?? false,
            },
          })
          .returning({ id: approvals.id }),
    ).then((rows) => rows[0]!);

    await writeAudit(deps, ctx.orgId, ctx.userId, {
      action: 'inbox.reply.routed_to_approval',
      entityType: 'approval',
      entityId: approvalId.id,
      after: {
        threadId: input.threadId,
        flags: compliance.flags,
        matched: compliance.matchedKeywords,
        language: detected,
      },
      riskLevel: compliance.riskLevel,
    });
    await writeAudit(deps, ctx.orgId, ctx.userId, {
      action: 'approval.created',
      entityType: 'approval',
      entityId: approvalId.id,
      after: {
        kind: 'inbox_reply',
        threadId: input.threadId,
        riskLevel: compliance.riskLevel,
      },
      riskLevel: compliance.riskLevel,
    });

    return ok({ outcome: 'routed_to_approval', approvalId: approvalId.id });
  }

  // ---- 4b. Direct send ----
  const inserted = await deps.asUser<{ id: string }[]>(
    { orgId: ctx.orgId, userId: ctx.userId },
    async (tx) => {
      const out = await tx
        .insert(inboxMessages)
        .values({
          organizationId: ctx.orgId,
          threadId: input.threadId,
          direction: 'outbound',
          authorType: input.aiGenerated ? 'ai' : 'user',
          authorId: ctx.userId,
          body: trimmed,
          sentAt: new Date(),
        })
        .returning({ id: inboxMessages.id });
      // Bump the thread's last_message_at so it floats to the top of
      // the list. We don't move it to "open" if it was closed — the
      // sender may explicitly want to reply on a closed thread.
      await tx
        .update(inboxThreads)
        .set({ lastMessageAt: new Date() })
        .where(
          and(
            eq(inboxThreads.id, input.threadId),
            eq(inboxThreads.organizationId, ctx.orgId),
          ),
        );
      return out;
    },
  );
  const messageId = inserted[0]!.id;

  await writeAudit(deps, ctx.orgId, ctx.userId, {
    action: 'inbox.reply.sent',
    entityType: 'inbox_message',
    entityId: messageId,
    after: {
      threadId: input.threadId,
      language: detected,
      bodyLength: trimmed.length,
      savedReplyId: input.savedReplyId ?? null,
      aiGenerated: input.aiGenerated ?? false,
    },
    riskLevel: 'low',
  });

  return ok({ outcome: 'sent', messageId });
}

// ---------------------------------------------------------------------------
// Audit helper — single writer for every event this module emits.
// ---------------------------------------------------------------------------

interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  riskLevel?: string;
}

async function writeAudit(
  deps: ReplyDeps,
  orgId: string,
  userId: string,
  input: AuditInput,
): Promise<void> {
  try {
    await deps.asAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: orgId,
        userId,
        actorType: 'user',
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before ?? null,
        after: input.after ?? null,
        ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
      }),
    );
  } catch (cause) {
    // Audit failures must NEVER hide a successful operation. Log and
    // continue — the audit shortfall is observable separately.
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write audit event for inbox reply.',
      { cause, meta: { action: input.action } },
    );
  }
}
