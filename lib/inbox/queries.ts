import 'server-only';

import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { type AnyPgTx, dbAs } from '../db/client';
import { contactProfiles, inboxThreads } from '../db/schema';

import { encodeThreadCursor, type ThreadCursor } from './cursor';
import type { InboxFilters } from './filters';

/**
 * Listing primitives for the /inbox view. Everything reads through `dbAs`
 * so RLS enforces tenant isolation in the DB; the redundant
 * `eq(inboxThreads.organizationId, orgId)` predicate is defense-in-depth
 * and helps the planner pick the right index.
 *
 * # Pagination
 *
 * Cursor-based on `(last_message_at DESC, id DESC)`. We query LIMIT
 * pageSize+1 and use the extra row as a "has more?" signal — when it
 * exists, the cursor for the next page points at the last visible row's
 * `(last_message_at, id)` tuple. The predicate
 * `(last_message_at, id) < (cursor.t, cursor.i)` is a single tuple
 * comparison Postgres compiles down to an index seek on
 * `inbox_threads_org_last_message_idx`.
 *
 * # Full-text search
 *
 * When `filters.q` is set we add `EXISTS` over `inbox_messages` matched
 * by the GIN-backed `search_tsv` column. `plainto_tsquery` is intentional
 * — it strips operators (`& | ! :` etc.) before parsing, so user input
 * can never form a tsquery that errors or matches everything.
 */

const DEFAULT_PAGE_SIZE = 50;

/** Shape returned to client components — keep it stable. */
export interface ThreadListItem {
  readonly id: string;
  readonly platform: string;
  readonly kind: 'dm' | 'comment' | 'mention' | 'review' | 'whatsapp';
  readonly status: 'open' | 'pending' | 'closed' | 'snoozed' | 'spam';
  readonly priority: 'low' | 'normal' | 'high' | 'urgent';
  readonly sentiment: 'positive' | 'neutral' | 'negative' | 'unknown';
  readonly assignedTo: string | null;
  readonly subject: string | null;
  readonly lastMessageAt: Date;
  readonly tags: ReadonlyArray<string>;
  readonly contactName: string | null;
  readonly contactHandle: string | null;
  readonly contactAvatarUrl: string | null;
  readonly snippet: string | null;
}

export interface ThreadListPage {
  readonly threads: ReadonlyArray<ThreadListItem>;
  readonly nextCursor: string | null;
}

export interface ListThreadsOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly filters: InboxFilters;
  readonly cursor: ThreadCursor | null;
  readonly pageSize?: number;
}

export async function listThreads(opts: ListThreadsOpts): Promise<ThreadListPage> {
  return dbAs(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) => listThreadsWithTx(tx, opts),
  );
}

/**
 * Same query as `listThreads`, but takes an existing transaction. Used by
 * integration tests that run inside `runAs(testDb, ctx, ...)` — keeps
 * the production path going through `dbAs` while letting tests inject a
 * pglite fixture without touching the runtime singleton.
 */
export async function listThreadsWithTx(
  tx: AnyPgTx,
  opts: ListThreadsOpts,
): Promise<ThreadListPage> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const { orgId, userId, filters, cursor } = opts;

  const conditions: SQL[] = [eq(inboxThreads.organizationId, orgId)];

  if (filters.status?.length) {
    conditions.push(inArray(inboxThreads.status, filters.status as Array<typeof filters.status[number]>));
  }
  if (filters.priority?.length) {
    conditions.push(inArray(inboxThreads.priority, filters.priority as Array<typeof filters.priority[number]>));
  }
  if (filters.kind?.length) {
    conditions.push(inArray(inboxThreads.kind, filters.kind as Array<typeof filters.kind[number]>));
  }
  if (filters.sentiment?.length) {
    conditions.push(inArray(inboxThreads.sentiment, filters.sentiment as Array<typeof filters.sentiment[number]>));
  }
  if (filters.platform?.length) {
    conditions.push(inArray(inboxThreads.platform, filters.platform as string[]));
  }
  if (filters.brandId) {
    conditions.push(eq(inboxThreads.brandId, filters.brandId));
  }
  if (filters.locationId) {
    conditions.push(eq(inboxThreads.locationId, filters.locationId));
  }
  if (filters.assignedTo === 'unassigned') {
    conditions.push(isNull(inboxThreads.assignedTo));
  } else if (filters.assignedTo === 'me') {
    conditions.push(eq(inboxThreads.assignedTo, userId));
  } else if (typeof filters.assignedTo === 'string') {
    conditions.push(eq(inboxThreads.assignedTo, filters.assignedTo));
  }
  if (filters.tags?.length) {
    // jsonb `@>` containment: every tag in the filter must be present.
    // GIN index on `inbox_threads_tags_gin` covers this predicate.
    conditions.push(
      sql`${inboxThreads.tags} @> ${JSON.stringify(filters.tags)}::jsonb`,
    );
  }
  if (filters.q) {
    // EXISTS over the messages table with a parameterised tsquery.
    // plainto_tsquery sanitises operators — the input is safe regardless
    // of what the user typed.
    conditions.push(sql`EXISTS (
      SELECT 1 FROM inbox_messages m
      WHERE m.thread_id = ${inboxThreads.id}
        AND m.search_tsv @@ plainto_tsquery('simple', ${filters.q})
    )`);
  }
  if (cursor) {
    // Composite cursor predicate. Postgres uses an index range scan when
    // the ORDER BY matches `(last_message_at DESC, id DESC)`.
    conditions.push(
      sql`(${inboxThreads.lastMessageAt}, ${inboxThreads.id}) < (${cursor.t}::timestamptz, ${cursor.i}::uuid)`,
    );
  }

  type Row = {
    id: string;
    platform: string;
    kind: ThreadListItem['kind'];
    status: ThreadListItem['status'];
    priority: ThreadListItem['priority'];
    sentiment: ThreadListItem['sentiment'];
    assignedTo: string | null;
    subject: string | null;
    lastMessageAt: Date;
    tags: unknown;
    contactName: string | null;
    contactHandle: string | null;
    contactAvatarUrl: string | null;
    snippet: string | null;
  };

  const rows: Row[] = await tx
    .select({
      id: inboxThreads.id,
      platform: inboxThreads.platform,
      kind: inboxThreads.kind,
      status: inboxThreads.status,
      priority: inboxThreads.priority,
      sentiment: inboxThreads.sentiment,
      assignedTo: inboxThreads.assignedTo,
      subject: inboxThreads.subject,
      lastMessageAt: inboxThreads.lastMessageAt,
      tags: inboxThreads.tags,
      contactName: contactProfiles.displayName,
      contactHandle: contactProfiles.handle,
      contactAvatarUrl: contactProfiles.avatarUrl,
      // Most recent message body as a one-line preview. The
      // correlated subquery is cheap at page size 50 because of the
      // (thread_id, sent_at DESC) index.
      snippet: sql<string | null>`(
        SELECT substring(body from 1 for 240)
        FROM inbox_messages m
        WHERE m.thread_id = ${inboxThreads.id}
        ORDER BY m.sent_at DESC
        LIMIT 1
      )`.as('snippet'),
    })
    .from(inboxThreads)
    .leftJoin(contactProfiles, eq(contactProfiles.id, inboxThreads.contactProfileId))
    .where(and(...conditions))
    .orderBy(desc(inboxThreads.lastMessageAt), desc(inboxThreads.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const visible = hasMore ? rows.slice(0, pageSize) : rows;
  const tail = visible[visible.length - 1];
  const nextCursor =
    hasMore && tail
      ? encodeThreadCursor({
          t: tail.lastMessageAt.toISOString(),
          i: tail.id,
        })
      : null;

  return {
    threads: visible.map(
      (r): ThreadListItem => ({
        id: r.id,
        platform: r.platform,
        kind: r.kind,
        status: r.status,
        priority: r.priority,
        sentiment: r.sentiment,
        assignedTo: r.assignedTo,
        subject: r.subject,
        lastMessageAt: r.lastMessageAt,
        tags: Array.isArray(r.tags) ? (r.tags as string[]) : [],
        contactName: r.contactName,
        contactHandle: r.contactHandle,
        contactAvatarUrl: r.contactAvatarUrl,
        snippet: r.snippet,
      }),
    ),
    nextCursor,
  };
}

/**
 * Cheap "do we have ANY threads at all" probe. Drives the empty-state
 * branching: if `false` the user has never received a message; if
 * `true` and the filtered page is empty, the filters are why.
 */
export async function orgHasAnyThreads(opts: {
  orgId: string;
  userId: string;
}): Promise<boolean> {
  const rows = await dbAs<Array<{ id: string }>>(
    { orgId: opts.orgId, userId: opts.userId },
    async (tx) =>
      tx
        .select({ id: inboxThreads.id })
        .from(inboxThreads)
        .where(eq(inboxThreads.organizationId, opts.orgId))
        .limit(1),
  );
  return rows.length > 0;
}
