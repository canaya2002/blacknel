'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  contactProfiles,
  inboxThreads,
  listeningMentions,
  listeningTrackedTerms,
  type ListeningMention,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import {
  listMentions,
  type MentionRow,
} from '@/lib/listening/queries';
import {
  addTrackedTermSchema,
  exportListeningCsvSchema,
  removeTrackedTermSchema,
  triageMentionSchema,
} from '@/lib/listening/validate';
import { authorize } from '@/lib/permissions/can';
import { requirePlanFeature } from '@/lib/plans/gates';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Listening Server Actions (Phase 9 / Commit 33).
 *
 *   - `addTrackedTermAction`            — admin/manager+ adds a watch.
 *   - `removeTrackedTermAction`         — soft-archive via `status='archived'`.
 *   - `triageMentionAction`             — archive | mark_lead | unmark_lead |
 *                                         assign_to_thread (creates inbox row +
 *                                         updates both FKs).
 *   - `exportListeningMentionsCsvAction`— Ajuste A.
 */

// ---------------------------------------------------------------------------
// addTrackedTermAction
// ---------------------------------------------------------------------------

export async function addTrackedTermAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ termId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'listening:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'listening_mentions');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = addTrackedTermSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Term inválido.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(listeningTrackedTerms)
        .values({
          organizationId: session.orgId,
          ...(data.brandId ? { brandId: data.brandId } : {}),
          term: data.term,
          termKind: data.termKind,
          platforms: data.platforms,
          status: 'active',
        })
        .returning({ id: listeningTrackedTerms.id }),
  );
  const termId = inserted[0]?.id;
  if (!termId) {
    return err('INTERNAL_ERROR', 'No se pudo crear el tracked term.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'listening.term.added',
        entityType: 'listening_tracked_term',
        entityId: termId,
        after: {
          term: data.term,
          termKind: data.termKind,
          platforms: data.platforms,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit listening.term.added.',
      { cause, meta: { termId } },
    );
  }

  revalidatePath('/listening');
  return ok({ termId });
}

// ---------------------------------------------------------------------------
// removeTrackedTermAction (archive)
// ---------------------------------------------------------------------------

export async function removeTrackedTermAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ termId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'listening:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'listening_mentions');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = removeTrackedTermSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'termId inválido.');
  }

  const now = new Date();
  const updated = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(listeningTrackedTerms)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(listeningTrackedTerms.organizationId, session.orgId),
            eq(listeningTrackedTerms.id, parsed.data.termId),
          ),
        )
        .returning({ id: listeningTrackedTerms.id }),
  );
  if (updated.length === 0) {
    return err('NOT_FOUND', 'Tracked term no encontrado.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'listening.term.archived',
        entityType: 'listening_tracked_term',
        entityId: parsed.data.termId,
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit listening.term.archived.',
      { cause },
    );
  }

  revalidatePath('/listening');
  return ok({ termId: parsed.data.termId });
}

// ---------------------------------------------------------------------------
// triageMentionAction — archive | mark_lead | unmark_lead | assign_to_thread
// ---------------------------------------------------------------------------

export async function triageMentionAction(
  _prev: unknown,
  input: unknown,
): Promise<
  Result<{
    mentionId: string;
    action: 'archive' | 'mark_lead' | 'unmark_lead' | 'assign_to_thread';
    threadId?: string;
  }>
> {
  const session = await requireUser();
  authorize(session.role, 'listening:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'listening_mentions');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = triageMentionSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Triage input inválido.');
  }
  const { mentionId, action } = parsed.data;

  // Load the mention to get its current state + platform + author.
  const existing: ListeningMention[] = await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select()
        .from(listeningMentions)
        .where(
          and(
            eq(listeningMentions.organizationId, session.orgId),
            eq(listeningMentions.id, mentionId),
          ),
        )
        .limit(1),
  );
  const mention = existing[0];
  if (!mention) {
    return err('NOT_FOUND', 'Mention no encontrada.');
  }

  const now = new Date();
  let threadId: string | undefined;

  if (action === 'archive') {
    await dbAs(
      { orgId: session.orgId, userId: session.userId },
      (tx) =>
        tx
          .update(listeningMentions)
          .set({ status: 'archived', updatedAt: now })
          .where(eq(listeningMentions.id, mentionId)),
    );
  } else if (action === 'mark_lead' || action === 'unmark_lead') {
    await dbAs(
      { orgId: session.orgId, userId: session.userId },
      (tx) =>
        tx
          .update(listeningMentions)
          .set({
            isLead: action === 'mark_lead',
            status: 'triaged',
            updatedAt: now,
          })
          .where(eq(listeningMentions.id, mentionId)),
    );
  } else {
    // assign_to_thread: create contact_profile + inbox_thread, wire
    // both FKs (mention.assigned_thread_id ↔ thread.source_mention_id).
    if (mention.assignedThreadId) {
      threadId = mention.assignedThreadId;
    } else {
      const txResult = await dbAs<{ threadId: string }>(
        { orgId: session.orgId, userId: session.userId },
        async (tx) => {
          // Upsert the contact profile keyed by (org, platform, handle).
          const existingContact: Array<{ id: string }> = await tx
            .select({ id: contactProfiles.id })
            .from(contactProfiles)
            .where(
              and(
                eq(contactProfiles.organizationId, session.orgId),
                eq(contactProfiles.platform, mention.platform),
                eq(contactProfiles.externalId, mention.authorHandle),
              ),
            )
            .limit(1);
          let contactId: string;
          if (existingContact.length > 0) {
            contactId = existingContact[0]!.id;
          } else {
            const insertedContact = await tx
              .insert(contactProfiles)
              .values({
                organizationId: session.orgId,
                platform: mention.platform,
                externalId: mention.authorHandle,
                displayName: mention.authorDisplayName,
                handle: mention.authorHandle,
              })
              .returning({ id: contactProfiles.id });
            contactId = insertedContact[0]!.id;
          }
          const insertedThread = await tx
            .insert(inboxThreads)
            .values({
              organizationId: session.orgId,
              ...(mention.brandId ? { brandId: mention.brandId } : {}),
              contactProfileId: contactId,
              platform: mention.platform,
              externalThreadId: `listening:${mention.id}`,
              kind: 'mention',
              status: 'open',
              lastMessageAt: mention.capturedAt,
              sourceMentionId: mention.id,
              metadata: {
                source: 'listening',
                mentionId: mention.id,
              },
            })
            .returning({ id: inboxThreads.id });
          const newThreadId = insertedThread[0]!.id;
          await tx
            .update(listeningMentions)
            .set({
              assignedThreadId: newThreadId,
              status: 'converted',
              updatedAt: now,
            })
            .where(eq(listeningMentions.id, mentionId));
          return { threadId: newThreadId };
        },
      );
      threadId = txResult.threadId;
    }
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: `listening.mention.${action}`,
        entityType: 'listening_mention',
        entityId: mentionId,
        after: {
          action,
          ...(threadId ? { threadId } : {}),
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      `Failed to audit listening.mention.${action}.`,
      { cause, meta: { mentionId } },
    );
  }

  revalidatePath('/listening');
  if (threadId) revalidatePath(`/inbox/${threadId}`);
  return ok(threadId ? { mentionId, action, threadId } : { mentionId, action });
}

// ---------------------------------------------------------------------------
// exportListeningMentionsCsvAction (Ajuste A)
// ---------------------------------------------------------------------------

export interface ListeningExportCsvSuccess {
  readonly csv: string;
  readonly filename: string;
  readonly rowCount: number;
  readonly sizeBytes: number;
}

export async function exportListeningMentionsCsvAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<ListeningExportCsvSuccess>> {
  const session = await requireUser();
  authorize(session.role, 'listening:manage');

  const plan = await getOrgPlanCode(session);
  try {
    requirePlanFeature(plan, 'listening_mentions');
  } catch (e) {
    if (e instanceof AppError) return err(e);
    throw e;
  }

  const parsed = exportListeningCsvSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Parámetros de export inválidos.');
  }
  const { period, status } = parsed.data;
  const brandId = parsed.data.brandId ?? null;
  const sinceDays = period === '7d' ? 7 : period === '30d' ? 30 : 90;

  const mentions: MentionRow[] = await listMentions({
    orgId: session.orgId,
    userId: session.userId,
    options: {
      status,
      brandId,
      sinceDays,
      limit: 1000,
    },
  });

  const header: string[] = [
    'captured_at',
    'platform',
    'author_handle',
    'body',
    'sentiment',
    'sentiment_score',
    'is_lead',
    'status',
    'url',
    'assigned_thread_id',
  ];
  const dataRows: string[][] = mentions.map((m) => [
    m.capturedAt.toISOString(),
    m.platform,
    m.authorHandle,
    m.body.slice(0, 500),
    m.sentiment,
    m.sentimentScore.toFixed(2),
    m.isLead ? 'true' : 'false',
    m.status,
    m.url ?? '',
    m.assignedThreadId ?? '',
  ]);
  const rows: ReadonlyArray<string[]> = [header, ...dataRows];

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const sizeBytes = Buffer.byteLength(csv, 'utf8');
  const now = new Date();
  const filename = `blacknel-listening-${period}-${now.toISOString().slice(0, 10)}.csv`;
  const rowCount = dataRows.length;

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'reports.csv.exported',
        entityType: 'report',
        entityId: null,
        after: {
          section: 'listening',
          filters: { status, brandId },
          period,
          rowCount,
          sizeBytes,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit reports.csv.exported (listening).',
      { cause, meta: { period, status } },
    );
  }

  return ok({ csv, filename, rowCount, sizeBytes });
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
