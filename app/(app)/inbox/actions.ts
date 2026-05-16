'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  inboxThreads,
  inboxThreadPriorityEnum,
  internalNotes,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for the inbox thread surface.
 *
 * Every action follows the same preamble:
 *
 *   1. requireUser() — session or throw UNAUTHORIZED.
 *   2. authorize(role, permission) — RBAC check.
 *   3. Zod parse of inputs.
 *   4. dbAs() — RLS-enforced transaction.
 *   5. dbAdmin() — audit event row (RLS bypass, intentional and audited).
 *   6. revalidatePath() — refresh the inbox + thread views.
 *
 * Composer / reply / AI suggestions / compliance check / approval creation
 * arrive in Commit 9. This file ships the CRUD that integration tests
 * exercise alongside the schema in Commit 7.
 */

const threadIdSchema = z.object({ threadId: z.string().uuid() });

async function writeAudit(
  orgId: string,
  userId: string,
  action: string,
  threadId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await dbAdmin(async (tx) =>
    tx.insert(auditEvents).values({
      organizationId: orgId,
      userId,
      actorType: 'user',
      action,
      entityType: 'inbox_thread',
      entityId: threadId,
      before,
      after,
    }),
  );
}

// ---------------------------------------------------------------------------
// assign / unassign
// ---------------------------------------------------------------------------

const assignSchema = z.object({
  threadId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
});

export async function assignThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:assign');

  const rawAssignee = formData.get('assigneeUserId');
  const parsed = assignSchema.safeParse({
    threadId: formData.get('threadId'),
    assigneeUserId:
      typeof rawAssignee === 'string' && rawAssignee.length > 0 ? rawAssignee : null,
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos para asignar.');

  const before = await dbAs<Array<{ assignedTo: string | null }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ assignedTo: inboxThreads.assignedTo })
        .from(inboxThreads)
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        )
        .limit(1),
  );
  if (before.length === 0) return err('NOT_FOUND', 'Thread no encontrado.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({ assignedTo: parsed.data.assigneeUserId })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        ),
  );

  await writeAudit(
    session.orgId,
    session.userId,
    'inbox.thread.assigned',
    parsed.data.threadId,
    { assignedTo: before[0]!.assignedTo },
    { assignedTo: parsed.data.assigneeUserId },
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId });
}

// ---------------------------------------------------------------------------
// close / reopen
// ---------------------------------------------------------------------------

export async function closeThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:close');
  const parsed = threadIdSchema.safeParse({ threadId: formData.get('threadId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const result = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({ status: 'closed', closedAt: new Date() })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        )
        .returning({ id: inboxThreads.id }),
  );
  if (result.length === 0) return err('NOT_FOUND', 'Thread no encontrado.');

  await writeAudit(
    session.orgId,
    session.userId,
    'inbox.thread.closed',
    parsed.data.threadId,
    null,
    { status: 'closed' },
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId });
}

export async function reopenThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:close');
  const parsed = threadIdSchema.safeParse({ threadId: formData.get('threadId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const result = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({ status: 'open', closedAt: null })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        )
        .returning({ id: inboxThreads.id }),
  );
  if (result.length === 0) return err('NOT_FOUND', 'Thread no encontrado.');

  await writeAudit(
    session.orgId,
    session.userId,
    'inbox.thread.reopened',
    parsed.data.threadId,
    null,
    { status: 'open' },
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId });
}

// ---------------------------------------------------------------------------
// escalate (bump priority to urgent — full escalation workflow is Phase 9)
// ---------------------------------------------------------------------------

export async function escalateThreadAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:assign');
  const parsed = threadIdSchema.safeParse({ threadId: formData.get('threadId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const before = await dbAs<Array<{ priority: 'low' | 'normal' | 'high' | 'urgent' }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ priority: inboxThreads.priority })
        .from(inboxThreads)
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        )
        .limit(1),
  );
  if (before.length === 0) return err('NOT_FOUND', 'Thread no encontrado.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({ priority: 'urgent' })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        ),
  );

  await writeAudit(
    session.orgId,
    session.userId,
    'inbox.thread.escalated',
    parsed.data.threadId,
    { priority: before[0]!.priority },
    { priority: 'urgent' },
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId });
}

// ---------------------------------------------------------------------------
// markSpam
// ---------------------------------------------------------------------------

export async function markSpamAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:close');
  const parsed = threadIdSchema.safeParse({ threadId: formData.get('threadId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  const result = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({ status: 'spam', closedAt: new Date() })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        )
        .returning({ id: inboxThreads.id }),
  );
  if (result.length === 0) return err('NOT_FOUND', 'Thread no encontrado.');

  await writeAudit(
    session.orgId,
    session.userId,
    'inbox.thread.marked_spam',
    parsed.data.threadId,
    null,
    { status: 'spam' },
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId });
}

// ---------------------------------------------------------------------------
// changePriority
// ---------------------------------------------------------------------------

const prioritySchema = z.object({
  threadId: z.string().uuid(),
  priority: z.enum(inboxThreadPriorityEnum.enumValues),
});

export async function changePriorityAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:assign');
  const parsed = prioritySchema.safeParse({
    threadId: formData.get('threadId'),
    priority: formData.get('priority'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Prioridad inválida.');

  const before = await dbAs<Array<{ priority: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ priority: inboxThreads.priority })
        .from(inboxThreads)
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        )
        .limit(1),
  );
  if (before.length === 0) return err('NOT_FOUND', 'Thread no encontrado.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({ priority: parsed.data.priority })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        ),
  );

  await writeAudit(
    session.orgId,
    session.userId,
    'inbox.thread.priority_changed',
    parsed.data.threadId,
    { priority: before[0]!.priority },
    { priority: parsed.data.priority },
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId });
}

// ---------------------------------------------------------------------------
// tags
// ---------------------------------------------------------------------------

const tagSchema = z.object({
  threadId: z.string().uuid(),
  tag: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/i, 'Tag inválido.'),
});

export async function addTagAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string; tag: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:assign');
  const parsed = tagSchema.safeParse({
    threadId: formData.get('threadId'),
    tag: formData.get('tag'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  // Append the tag using jsonb_array_concat semantics — skip if already
  // present so the array stays a set. Postgres' `jsonb || jsonb` collapses
  // duplicates only on objects, not arrays; we filter then concat.
  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({
          tags: sql`CASE
            WHEN ${inboxThreads.tags} @> ${JSON.stringify([parsed.data.tag])}::jsonb THEN ${inboxThreads.tags}
            ELSE ${inboxThreads.tags} || ${JSON.stringify([parsed.data.tag])}::jsonb
          END`,
        })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        ),
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId, tag: parsed.data.tag });
}

export async function removeTagAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string; tag: string }>> {
  const session = await requireUser();
  authorize(session.role, 'inbox:assign');
  const parsed = tagSchema.safeParse({
    threadId: formData.get('threadId'),
    tag: formData.get('tag'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  // Filter the array via jsonb_path_query / element comparison.
  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(inboxThreads)
        .set({
          tags: sql`(
            SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
            FROM jsonb_array_elements_text(${inboxThreads.tags}) AS t
            WHERE t <> ${parsed.data.tag}
          )`,
        })
        .where(
          and(
            eq(inboxThreads.id, parsed.data.threadId),
            eq(inboxThreads.organizationId, session.orgId),
          ),
        ),
  );

  revalidatePath('/inbox');
  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId, tag: parsed.data.tag });
}

// ---------------------------------------------------------------------------
// internal notes
// ---------------------------------------------------------------------------

const addNoteSchema = z.object({
  threadId: z.string().uuid(),
  body: z.string().min(1).max(4000),
  pinned: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true'),
});

export async function addInternalNoteAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ threadId: string; noteId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'notes:write');
  const parsed = addNoteSchema.safeParse({
    threadId: formData.get('threadId'),
    body: formData.get('body'),
    pinned: formData.get('pinned'),
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'La nota es inválida.');

  // We pass organization_id explicitly from the session — the BEFORE
  // INSERT trigger in 0005_inbox.sql is a defense-in-depth fallback for
  // code paths (seeds, dev tools, future cron jobs) that legitimately
  // don't carry an org context. RLS WITH CHECK still verifies the value
  // matches the session, so a forged session can't write across tenants.
  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .insert(internalNotes)
        .values({
          organizationId: session.orgId,
          threadId: parsed.data.threadId,
          authorId: session.userId,
          body: parsed.data.body,
          pinned: parsed.data.pinned ?? false,
        })
        .returning({ id: internalNotes.id }),
  );
  const row = inserted[0];
  if (!row) {
    throw new AppError('NOT_FOUND', 'No se pudo crear la nota — thread inválido.');
  }

  await writeAudit(
    session.orgId,
    session.userId,
    'inbox.note.added',
    parsed.data.threadId,
    null,
    { noteId: row.id, pinned: parsed.data.pinned ?? false },
  );

  revalidatePath(`/inbox/${parsed.data.threadId}`);
  return ok({ threadId: parsed.data.threadId, noteId: row.id });
}
