import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { classifySentiment } from '@/lib/ai/skills/sentiment';
import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts, listeningMentions, type NewListeningMention } from '@/lib/db/schema';
import { log } from '@/lib/log';

import type { NormalizedMention } from './base/normalized';
import type { ConnectorAccount, PlatformCode } from './base/types';
import { fetchMentionsForAccount } from './mentions-dispatch';

/**
 * Account-based mentions poll-sync (C53). Platforms don't push @mentions, so a
 * cron polls each connected account for the mentions/tags surfaced ON it (real
 * Meta when gated, mock otherwise), classifies sentiment via the C43 skill, and
 * upserts into the existing listening_mentions table UNDER each connection's org
 * RLS — with connected_account_id set and tracked_term_id null (not term-matched;
 * the term-based broad-listening scan is a separate, dev-only path).
 *
 * Idempotent on (org, platform, external_id): an already-captured mention is
 * skipped WITHOUT re-running the AI (no churn, no cost). Sentiment runs OUTSIDE
 * the tx; the decrypted token never leaves the dispatcher.
 *
 * Honest scope: covers mentions reachable via platform APIs (mostly Meta).
 * Broad web listening needs an external provider (Brandwatch/Talkwalker) we
 * don't have — out of scope by design.
 */

const MENTIONS_PLATFORMS: ReadonlyArray<string> = [
  'facebook',
  'instagram',
  'x',
  'tiktok',
  'linkedin',
  'youtube',
];

export interface MentionsSyncDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  fetchMentions: (account: ConnectorAccount) => Promise<NormalizedMention[]>;
  classify: (
    text: string,
    ctx: { orgId: string; brandId: string | null },
  ) => Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; confidence: number }>;
}

function defaultClassify(
  text: string,
  ctx: { orgId: string; brandId: string | null },
): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; confidence: number }> {
  return classifySentiment({
    text,
    context: {
      orgId: ctx.orgId,
      userId: null,
      actorType: 'system',
      entityType: 'org',
      entityId: null,
      ...(ctx.brandId ? { brandId: ctx.brandId } : {}),
    },
  });
}

function defaultDeps(): MentionsSyncDeps {
  return {
    asAdmin: (fn) => dbAdmin(fn),
    orgTx: (orgId, fn) => dbAsOrg(orgId, fn),
    fetchMentions: fetchMentionsForAccount,
    classify: defaultClassify,
  };
}

export interface MentionsSyncReport {
  accounts: number;
  inserted: number;
  skipped: number;
  failed: number;
}

/** Map a NormalizedMention's -1..1 sentiment hint to the enum (fallback only). */
function hintToEnum(hint: number | undefined): 'positive' | 'neutral' | 'negative' {
  if (hint == null) return 'neutral';
  if (hint > 0.15) return 'positive';
  if (hint < -0.15) return 'negative';
  return 'neutral';
}

export async function runMentionsSync(
  deps: MentionsSyncDeps = defaultDeps(),
): Promise<MentionsSyncReport> {
  const rows = await deps.asAdmin<
    Array<{
      id: string;
      organizationId: string;
      brandId: string | null;
      locationId: string | null;
      platform: string;
      externalAccountId: string | null;
      displayName: string | null;
      handle: string | null;
      status: ConnectorAccount['status'];
      metadata: unknown;
    }>
  >((tx) =>
    tx
      .select({
        id: connectedAccounts.id,
        organizationId: connectedAccounts.organizationId,
        brandId: connectedAccounts.brandId,
        locationId: connectedAccounts.locationId,
        platform: connectedAccounts.platform,
        externalAccountId: connectedAccounts.externalAccountId,
        displayName: connectedAccounts.displayName,
        handle: connectedAccounts.handle,
        status: connectedAccounts.status,
        metadata: connectedAccounts.metadata,
      })
      .from(connectedAccounts)
      .where(
        and(
          inArray(connectedAccounts.platform, [...MENTIONS_PLATFORMS]),
          eq(connectedAccounts.status, 'connected'),
        ),
      ),
  );

  let accounts = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    accounts += 1;
    const account: ConnectorAccount = {
      id: r.id,
      organizationId: r.organizationId,
      brandId: r.brandId,
      locationId: r.locationId,
      platform: r.platform as PlatformCode,
      externalAccountId: r.externalAccountId,
      displayName: r.displayName,
      handle: r.handle,
      status: r.status,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
    };

    let fetched: NormalizedMention[];
    try {
      fetched = await deps.fetchMentions(account);
    } catch (err) {
      failed += 1;
      log.warn({ accountId: r.id, err: (err as Error).message }, 'mentions_sync.fetch_failed');
      continue;
    }
    if (fetched.length === 0) continue;

    // Skip already-captured mentions WITHOUT re-running the AI.
    const externalIds = fetched.map((m) => m.externalId);
    const existing = (await deps.orgTx(r.organizationId, (tx) =>
      tx
        .select({ externalId: listeningMentions.externalId })
        .from(listeningMentions)
        .where(
          and(
            eq(listeningMentions.organizationId, r.organizationId),
            eq(listeningMentions.platform, r.platform),
            inArray(listeningMentions.externalId, externalIds),
          ),
        ),
    )) as Array<{ externalId: string }>;
    const existingSet = new Set(existing.map((e) => e.externalId));
    const fresh = fetched.filter((m) => !existingSet.has(m.externalId));
    skipped += fetched.length - fresh.length;
    if (fresh.length === 0) continue;

    // Classify each fresh mention OUTSIDE the tx (AI latency / cost).
    const values: NewListeningMention[] = [];
    for (const m of fresh) {
      let sentiment: 'positive' | 'neutral' | 'negative' = hintToEnum(m.sentiment);
      let score = 0.5;
      try {
        const out = await deps.classify(m.body, { orgId: r.organizationId, brandId: r.brandId });
        sentiment = out.sentiment;
        score = out.confidence;
      } catch (err) {
        log.warn({ accountId: r.id, externalId: m.externalId, err: (err as Error).message }, 'mentions_sync.sentiment_fallback');
      }
      values.push({
        organizationId: r.organizationId,
        connectedAccountId: r.id,
        brandId: r.brandId,
        platform: m.platform,
        externalId: m.externalId,
        authorHandle: m.author.handle ?? m.author.displayName ?? 'unknown',
        authorDisplayName: m.author.displayName ?? null,
        body: m.body,
        url: m.url ?? null,
        kind: 'post',
        sentiment,
        sentimentScore: score.toFixed(2),
        capturedAt: m.postedAt,
      });
    }

    const ins = (await deps.orgTx(r.organizationId, (tx) =>
      tx
        .insert(listeningMentions)
        .values(values)
        .onConflictDoNothing({
          target: [
            listeningMentions.organizationId,
            listeningMentions.platform,
            listeningMentions.externalId,
          ],
        })
        .returning({ id: listeningMentions.id }),
    )) as Array<{ id: string }>;
    inserted += ins.length;
  }

  const report: MentionsSyncReport = { accounts, inserted, skipped, failed };
  log.info(report, 'mentions_sync');
  return report;
}
