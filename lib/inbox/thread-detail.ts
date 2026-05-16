import 'server-only';

import { and, asc, desc, eq } from 'drizzle-orm';

import { dbAs } from '../db/client';
import {
  brands,
  contactProfiles,
  inboxMessages,
  inboxThreads,
  internalNotes,
  locations,
  savedReplies,
  users,
} from '../db/schema';

/**
 * Aggregates everything the /inbox/[threadId] page needs in three
 * round-trips (thread + messages + notes), all under the same `dbAs`
 * context so RLS evaluates once per request.
 *
 * The page composes this with `savedRepliesForOrg` so the composer's
 * picker has its list and the context panel its notes.
 */

export interface ThreadDetail {
  readonly thread: ThreadHeader;
  readonly messages: ReadonlyArray<MessageRow>;
  readonly notes: ReadonlyArray<NoteRow>;
}

export interface ThreadHeader {
  readonly id: string;
  readonly platform: string;
  readonly kind: 'dm' | 'comment' | 'mention' | 'review' | 'whatsapp';
  readonly status: 'open' | 'pending' | 'closed' | 'snoozed' | 'spam';
  readonly priority: 'low' | 'normal' | 'high' | 'urgent';
  readonly sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  readonly subject: string | null;
  readonly assignedTo: string | null;
  readonly assigneeName: string | null;
  readonly lastMessageAt: Date;
  readonly closedAt: Date | null;
  readonly tags: ReadonlyArray<string>;
  readonly contactId: string | null;
  readonly contactName: string | null;
  readonly contactHandle: string | null;
  readonly contactAvatarUrl: string | null;
  readonly contactLanguage: string | null;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly locationPhone: string | null;
}

export interface MessageRow {
  readonly id: string;
  readonly direction: 'inbound' | 'outbound';
  readonly authorType: 'contact' | 'user' | 'ai' | 'system';
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly body: string;
  readonly sentAt: Date;
}

export interface NoteRow {
  readonly id: string;
  readonly body: string;
  readonly pinned: boolean;
  readonly authorId: string | null;
  readonly authorName: string | null;
  readonly createdAt: Date;
}

export async function getThreadDetail(opts: {
  orgId: string;
  userId: string;
  threadId: string;
}): Promise<ThreadDetail | null> {
  const { orgId, userId, threadId } = opts;

  const headerRows = await dbAs<ThreadHeader[]>(
    { orgId, userId },
    async (tx) =>
      tx
        .select({
          id: inboxThreads.id,
          platform: inboxThreads.platform,
          kind: inboxThreads.kind,
          status: inboxThreads.status,
          priority: inboxThreads.priority,
          sentiment: inboxThreads.sentiment,
          subject: inboxThreads.subject,
          assignedTo: inboxThreads.assignedTo,
          assigneeName: users.name,
          lastMessageAt: inboxThreads.lastMessageAt,
          closedAt: inboxThreads.closedAt,
          tags: inboxThreads.tags,
          contactId: contactProfiles.id,
          contactName: contactProfiles.displayName,
          contactHandle: contactProfiles.handle,
          contactAvatarUrl: contactProfiles.avatarUrl,
          contactLanguage: contactProfiles.language,
          brandId: inboxThreads.brandId,
          brandName: brands.name,
          locationId: inboxThreads.locationId,
          locationName: locations.name,
          locationPhone: locations.phone,
        })
        .from(inboxThreads)
        .leftJoin(contactProfiles, eq(contactProfiles.id, inboxThreads.contactProfileId))
        .leftJoin(brands, eq(brands.id, inboxThreads.brandId))
        .leftJoin(locations, eq(locations.id, inboxThreads.locationId))
        .leftJoin(users, eq(users.id, inboxThreads.assignedTo))
        .where(
          and(
            eq(inboxThreads.id, threadId),
            eq(inboxThreads.organizationId, orgId),
          ),
        )
        .limit(1) as unknown as Promise<ThreadHeader[]>,
  );
  const header = headerRows[0];
  if (!header) return null;

  const [messages, notes] = await Promise.all([
    dbAs<MessageRow[]>({ orgId, userId }, async (tx) =>
      tx
        .select({
          id: inboxMessages.id,
          direction: inboxMessages.direction,
          authorType: inboxMessages.authorType,
          authorId: inboxMessages.authorId,
          authorName: users.name,
          body: inboxMessages.body,
          sentAt: inboxMessages.sentAt,
        })
        .from(inboxMessages)
        .leftJoin(users, eq(users.id, inboxMessages.authorId))
        .where(eq(inboxMessages.threadId, threadId))
        .orderBy(asc(inboxMessages.sentAt))
        .limit(500) as unknown as Promise<MessageRow[]>,
    ),
    dbAs<NoteRow[]>({ orgId, userId }, async (tx) =>
      tx
        .select({
          id: internalNotes.id,
          body: internalNotes.body,
          pinned: internalNotes.pinned,
          authorId: internalNotes.authorId,
          authorName: users.name,
          createdAt: internalNotes.createdAt,
        })
        .from(internalNotes)
        .leftJoin(users, eq(users.id, internalNotes.authorId))
        .where(eq(internalNotes.threadId, threadId))
        .orderBy(desc(internalNotes.pinned), desc(internalNotes.createdAt))
        .limit(50) as unknown as Promise<NoteRow[]>,
    ),
  ]);

  return {
    thread: {
      ...header,
      tags: Array.isArray(header.tags) ? (header.tags as string[]) : [],
    },
    messages,
    notes,
  };
}

export interface SavedReplyOption {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly language: string;
  readonly body: string;
  readonly requiresApproval: boolean;
}

export async function savedRepliesForOrg(opts: {
  orgId: string;
  userId: string;
}): Promise<ReadonlyArray<SavedReplyOption>> {
  return dbAs<SavedReplyOption[]>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({
          id: savedReplies.id,
          name: savedReplies.name,
          category: savedReplies.category,
          language: savedReplies.language,
          body: savedReplies.body,
          requiresApproval: savedReplies.requiresApproval,
        })
        .from(savedReplies)
        .where(eq(savedReplies.organizationId, opts.orgId))
        .orderBy(asc(savedReplies.category), asc(savedReplies.name)) as unknown as Promise<
        SavedReplyOption[]
      >,
  );
}
