import 'server-only';

import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  brands,
  listeningMentions,
  listeningTrackedTerms,
  type ListeningMention,
  type ListeningMentionStatus,
  type ListeningTermStatus,
  type ListeningTrackedTerm,
} from '@/lib/db/schema';

/**
 * Read layer for listening (Phase 9 / Commit 33). All entry points
 * go through `dbAs` so RLS scopes rows to the caller's org.
 */

// ---------------------------------------------------------------------------
// Tracked terms
// ---------------------------------------------------------------------------

export interface TrackedTermRow {
  readonly id: string;
  readonly brandId: string | null;
  readonly brandName: string | null;
  readonly term: string;
  readonly termKind: ListeningTrackedTerm['termKind'];
  readonly platforms: ReadonlyArray<string>;
  readonly status: ListeningTermStatus;
  readonly createdAt: Date;
  readonly mentionCount: number;
}

export async function listTrackedTermsWithTx(
  tx: AnyPgTx,
  orgId: string,
): Promise<TrackedTermRow[]> {
  const rows: Array<{
    term: ListeningTrackedTerm;
    brandName: string | null;
    mentionCount: number;
  }> = await tx
    .select({
      term: listeningTrackedTerms,
      brandName: brands.name,
      mentionCount: sql<number>`COALESCE((
        SELECT COUNT(*)::int FROM ${listeningMentions}
        WHERE ${listeningMentions}.tracked_term_id = ${listeningTrackedTerms}.id
      ), 0)`,
    })
    .from(listeningTrackedTerms)
    .leftJoin(brands, eq(brands.id, listeningTrackedTerms.brandId))
    .where(eq(listeningTrackedTerms.organizationId, orgId))
    .orderBy(
      asc(listeningTrackedTerms.status),
      desc(listeningTrackedTerms.createdAt),
    );

  return rows.map((r) => ({
    id: r.term.id,
    brandId: r.term.brandId,
    brandName: r.brandName,
    term: r.term.term,
    termKind: r.term.termKind,
    platforms: r.term.platforms,
    status: r.term.status,
    createdAt: r.term.createdAt,
    mentionCount: r.mentionCount,
  }));
}

export async function listTrackedTerms(ctx: {
  orgId: string;
  userId: string;
}): Promise<TrackedTermRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listTrackedTermsWithTx(tx, ctx.orgId),
  );
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

export interface MentionRow {
  readonly id: string;
  // Nullable since C53: account-discovered mentions match no tracked term.
  readonly trackedTermId: string | null;
  readonly term: string | null;
  readonly termKind: ListeningTrackedTerm['termKind'] | null;
  readonly brandId: string | null;
  readonly platform: string;
  readonly authorHandle: string;
  readonly authorDisplayName: string | null;
  readonly body: string;
  readonly url: string | null;
  readonly kind: ListeningMention['kind'];
  readonly sentiment: ListeningMention['sentiment'];
  readonly sentimentScore: number;
  readonly isLead: boolean;
  readonly status: ListeningMentionStatus;
  readonly capturedAt: Date;
  readonly assignedThreadId: string | null;
}

export interface ListMentionsOptions {
  readonly status?: ListeningMentionStatus | 'all';
  readonly isLead?: boolean;
  readonly brandId?: string | null;
  readonly trackedTermId?: string | null;
  readonly limit?: number;
  readonly sinceDays?: number;
}

export async function listMentionsWithTx(
  tx: AnyPgTx,
  orgId: string,
  opts: ListMentionsOptions = {},
): Promise<MentionRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const conds = [eq(listeningMentions.organizationId, orgId)];
  if (opts.status && opts.status !== 'all') {
    conds.push(eq(listeningMentions.status, opts.status));
  }
  if (opts.isLead !== undefined) {
    conds.push(eq(listeningMentions.isLead, opts.isLead));
  }
  if (opts.brandId) {
    conds.push(eq(listeningMentions.brandId, opts.brandId));
  }
  if (opts.trackedTermId) {
    conds.push(eq(listeningMentions.trackedTermId, opts.trackedTermId));
  }
  if (opts.sinceDays && opts.sinceDays > 0) {
    conds.push(
      gte(
        listeningMentions.capturedAt,
        new Date(Date.now() - opts.sinceDays * 86_400_000),
      ),
    );
  }

  const rows: Array<{
    mention: ListeningMention;
    term: string | null;
    termKind: ListeningTrackedTerm['termKind'] | null;
  }> = await tx
    .select({
      mention: listeningMentions,
      term: listeningTrackedTerms.term,
      termKind: listeningTrackedTerms.termKind,
    })
    .from(listeningMentions)
    // LEFT JOIN (C53): account-discovered mentions have a NULL tracked_term_id
    // and must still surface in the feed / leads / CSV, consistent with the KPI
    // aggregates which count them.
    .leftJoin(
      listeningTrackedTerms,
      eq(listeningTrackedTerms.id, listeningMentions.trackedTermId),
    )
    .where(and(...conds))
    .orderBy(desc(listeningMentions.capturedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.mention.id,
    trackedTermId: r.mention.trackedTermId,
    term: r.term,
    termKind: r.termKind,
    brandId: r.mention.brandId,
    platform: r.mention.platform,
    authorHandle: r.mention.authorHandle,
    authorDisplayName: r.mention.authorDisplayName,
    body: r.mention.body,
    url: r.mention.url,
    kind: r.mention.kind,
    sentiment: r.mention.sentiment,
    sentimentScore: Number(r.mention.sentimentScore),
    isLead: r.mention.isLead,
    status: r.mention.status,
    capturedAt: r.mention.capturedAt,
    assignedThreadId: r.mention.assignedThreadId,
  }));
}

export async function listMentions(ctx: {
  orgId: string;
  userId: string;
  options?: ListMentionsOptions;
}): Promise<MentionRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listMentionsWithTx(tx, ctx.orgId, ctx.options ?? {}),
  );
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export interface ListeningAggregates {
  readonly total: number;
  readonly bySentiment: { positive: number; neutral: number; negative: number };
  readonly leads: number;
  readonly converted: number;
  readonly archived: number;
}

export async function getListeningAggregatesWithTx(
  tx: AnyPgTx,
  orgId: string,
  sinceDays = 30,
): Promise<ListeningAggregates> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);
  const rows: Array<{
    sentiment: ListeningMention['sentiment'];
    status: ListeningMentionStatus;
    isLead: boolean;
    count: number;
  }> = await tx
    .select({
      sentiment: listeningMentions.sentiment,
      status: listeningMentions.status,
      isLead: listeningMentions.isLead,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(listeningMentions)
    .where(
      and(
        eq(listeningMentions.organizationId, orgId),
        gte(listeningMentions.capturedAt, since),
      ),
    )
    .groupBy(
      listeningMentions.sentiment,
      listeningMentions.status,
      listeningMentions.isLead,
    );

  const bySentiment = { positive: 0, neutral: 0, negative: 0 };
  let total = 0;
  let leads = 0;
  let converted = 0;
  let archived = 0;
  for (const r of rows) {
    total += r.count;
    if (r.sentiment === 'positive') bySentiment.positive += r.count;
    else if (r.sentiment === 'negative') bySentiment.negative += r.count;
    else if (r.sentiment === 'neutral') bySentiment.neutral += r.count;
    if (r.isLead) leads += r.count;
    if (r.status === 'converted') converted += r.count;
    if (r.status === 'archived') archived += r.count;
  }
  return { total, bySentiment, leads, converted, archived };
}

export async function getListeningAggregates(ctx: {
  orgId: string;
  userId: string;
  sinceDays?: number;
}): Promise<ListeningAggregates> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    getListeningAggregatesWithTx(tx, ctx.orgId, ctx.sinceDays ?? 30),
  );
}
