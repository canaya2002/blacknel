import 'server-only';

import { eq } from 'drizzle-orm';

import { type AnyPgTx, dbAsOrg } from '@/lib/db/client';
import { connectedAccounts, reviewResponses, reviews } from '@/lib/db/schema';

import type { ConnectorAccount, PlatformCode } from './base/types';
import type { NormalizedReview } from './base/normalized';
import { getConnector } from './registry';
import { readAccountTokens } from './tokens';

/**
 * Server-only review dispatchers (C49): real-vs-mock routing for fetching reviews
 * and posting replies, kept out of the client-reachable connector registry (same
 * pattern as publish-dispatch). gbp + isRealGbpEnabled → real GBP API; otherwise
 * the connector's mock fetch/reply.
 */

/** Fetch a connection's reviews (real GBP API when gated, else mock connector). */
export async function fetchReviewsForAccount(
  account: ConnectorAccount,
): Promise<NormalizedReview[]> {
  if (account.platform === 'gbp') {
    const { isRealGbpEnabled } = await import('./gbp/config');
    if (await isRealGbpEnabled()) {
      const tokens = await dbAsOrg(account.organizationId, (tx) =>
        readAccountTokens(tx, account.id),
      );
      if (!tokens?.accessToken) return [];
      const { fetchGbpReviews } = await import('./gbp/reviews');
      return fetchGbpReviews(account, tokens.accessToken);
    }
  }
  const connector = getConnector(account.platform);
  if (typeof connector.fetchReviews !== 'function') return [];
  const page = await connector.fetchReviews(account, { limit: 25 });
  return [...page.items];
}

export interface ReplyPostDeps {
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

function defaultDeps(): ReplyPostDeps {
  return { orgTx: (orgId, fn) => dbAsOrg(orgId, fn) };
}

export interface ReplyPostResult {
  posted: boolean;
  externalResponseId?: string;
  reason?: string;
}

/**
 * Post a published review_response to the platform (best-effort, idempotent).
 * Reads the response + its review + the connection under the org's RLS, dispatches
 * the reply (real GBP when gated, else mock connector.replyReview), and records
 * external_response_id. Skips if already posted or the review lacks a connection /
 * external id (e.g. manually-ingested reviews).
 */
export async function postReviewReplyToPlatform(
  input: { orgId: string; responseId: string },
  deps: ReplyPostDeps = defaultDeps(),
): Promise<ReplyPostResult> {
  const { orgId, responseId } = input;

  const ctx = await deps.orgTx(orgId, async (tx) => {
    const rows = (await tx
      .select({
        finalText: reviewResponses.finalText,
        externalResponseId: reviewResponses.externalResponseId,
        reviewId: reviewResponses.reviewId,
        platform: reviews.platform,
        externalReviewId: reviews.externalReviewId,
        accountId: reviews.connectedAccountId,
      })
      .from(reviewResponses)
      .innerJoin(reviews, eq(reviews.id, reviewResponses.reviewId))
      .where(eq(reviewResponses.id, responseId))
      .limit(1)) as Array<{
      finalText: string | null;
      externalResponseId: string | null;
      reviewId: string;
      platform: string;
      externalReviewId: string | null;
      accountId: string | null;
    }>;
    const row = rows[0];
    if (!row) return null;
    if (row.externalResponseId) return { ...row, skip: 'already_posted' as const };
    if (!row.accountId || !row.externalReviewId || !row.finalText) {
      return { ...row, skip: 'not_postable' as const };
    }
    const accRows = (await tx
      .select({
        id: connectedAccounts.id,
        platform: connectedAccounts.platform,
        brandId: connectedAccounts.brandId,
        locationId: connectedAccounts.locationId,
        externalAccountId: connectedAccounts.externalAccountId,
        displayName: connectedAccounts.displayName,
        handle: connectedAccounts.handle,
        status: connectedAccounts.status,
        metadata: connectedAccounts.metadata,
        tokens: connectedAccounts.oauthTokensEncrypted,
      })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, row.accountId))
      .limit(1)) as Array<Record<string, unknown>>;
    return { ...row, skip: null as null, account: accRows[0] ?? null };
  });

  if (!ctx) return { posted: false, reason: 'response_not_found' };
  if (ctx.skip === 'already_posted') {
    return { posted: false, reason: 'already_posted', ...(ctx.externalResponseId ? { externalResponseId: ctx.externalResponseId } : {}) };
  }
  if (ctx.skip === 'not_postable' || !('account' in ctx) || !ctx.account) {
    return { posted: false, reason: 'not_postable' };
  }

  const accountRow = ctx.account as Record<string, unknown>;
  const account: ConnectorAccount = {
    id: accountRow.id as string,
    organizationId: orgId,
    brandId: (accountRow.brandId as string | null) ?? null,
    locationId: (accountRow.locationId as string | null) ?? null,
    platform: accountRow.platform as PlatformCode,
    externalAccountId: (accountRow.externalAccountId as string | null) ?? null,
    displayName: (accountRow.displayName as string | null) ?? null,
    handle: (accountRow.handle as string | null) ?? null,
    status: accountRow.status as ConnectorAccount['status'],
    metadata: (accountRow.metadata as Record<string, unknown>) ?? {},
  };

  // Dispatch the reply (real GBP when gated, else mock connector).
  let externalId: string;
  if (account.platform === 'gbp') {
    const { isRealGbpEnabled } = await import('./gbp/config');
    if (await isRealGbpEnabled()) {
      const tokens = await deps.orgTx(orgId, (tx) => readAccountTokens(tx, account.id));
      if (!tokens?.accessToken) return { posted: false, reason: 'no_token' };
      const { replyGbpReview } = await import('./gbp/reviews');
      ({ externalId } = await replyGbpReview(account, ctx.externalReviewId!, ctx.finalText!, tokens.accessToken));
    } else {
      externalId = await mockReply(account, ctx.externalReviewId!, ctx.finalText!);
    }
  } else {
    externalId = await mockReply(account, ctx.externalReviewId!, ctx.finalText!);
  }

  await deps.orgTx(orgId, (tx) =>
    tx
      .update(reviewResponses)
      .set({ externalResponseId: externalId, updatedAt: new Date() })
      .where(eq(reviewResponses.id, responseId)),
  );
  return { posted: true, externalResponseId: externalId };
}

async function mockReply(
  account: ConnectorAccount,
  reviewId: string,
  body: string,
): Promise<string> {
  const connector = getConnector(account.platform);
  if (typeof connector.replyReview !== 'function') {
    return `mock-reply-${account.platform}-${reviewId}`;
  }
  const res = await connector.replyReview(account, reviewId, body);
  return res.externalId;
}
