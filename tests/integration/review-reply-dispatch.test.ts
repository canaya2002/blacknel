import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import {
  connectedAccounts,
  organizations,
  plans,
  reviewResponses,
  reviews,
} from '../../lib/db/schema';
import { postReviewReplyToPlatform, type ReplyPostDeps } from '../../lib/connectors/reviews-dispatch';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C49 review reply → platform. With use_real_gbp off, the dispatcher routes to
 * the connector's mock reply and records external_response_id. Idempotent
 * (already-posted → skip) and skips reviews with no connection / external id.
 */

let fixture: TestDb;
let deps: ReplyPostDeps;

const planId = '00000000-0000-4000-8000-d49100000001';
const orgA = '49144444-4444-4444-8491-a00000000001';
const accountA = '49166666-6666-4666-8491-a00000000001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'growth', name: 'Growth', priceCents: 19900 });
    await tx.insert(organizations).values({ id: orgA, name: 'Reply A', slug: 'reply-a', planId });
    await tx.insert(connectedAccounts).values({
      id: accountA,
      organizationId: orgA,
      platform: 'gbp',
      externalAccountId: 'accounts/a/locations/1',
      status: 'connected',
    });
  });
  deps = { orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn) };
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

beforeEach(async () => {
  await runAdmin(fixture.db, async (tx) => {
    await tx.delete(reviewResponses);
    await tx.delete(reviews);
  });
});

async function seedReviewWithResponse(opts: {
  reviewId: string;
  responseId: string;
  externalReviewId: string | null;
  connectedAccountId: string | null;
}): Promise<void> {
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(reviews).values({
      id: opts.reviewId,
      organizationId: orgA,
      platform: 'gbp',
      externalReviewId: opts.externalReviewId,
      connectedAccountId: opts.connectedAccountId,
      rating: 5,
      body: 'Great!',
    });
    await tx.insert(reviewResponses).values({
      id: opts.responseId,
      organizationId: orgA,
      reviewId: opts.reviewId,
      finalText: 'Thank you so much!',
      status: 'published',
      publishedAt: new Date(),
    });
  });
}

describe('postReviewReplyToPlatform', () => {
  it('posts via the mock connector and records external_response_id', async () => {
    const reviewId = '49177777-7777-4777-8491-a00000000001';
    const responseId = '49188888-8888-4888-8491-a00000000001';
    await seedReviewWithResponse({ reviewId, responseId, externalReviewId: 'gbp-rev-1', connectedAccountId: accountA });

    const res = await postReviewReplyToPlatform({ orgId: orgA, responseId }, deps);
    expect(res.posted).toBe(true);
    expect(res.externalResponseId).toBeTruthy();

    const stored = await runAdmin<Array<{ ext: string | null }>>(fixture.db, (tx) =>
      tx.select({ ext: reviewResponses.externalResponseId }).from(reviewResponses).where(eq(reviewResponses.id, responseId)),
    );
    expect(stored[0]?.ext).toBe(res.externalResponseId);

    // Idempotent: second call sees external_response_id set and skips.
    const again = await postReviewReplyToPlatform({ orgId: orgA, responseId }, deps);
    expect(again).toMatchObject({ posted: false, reason: 'already_posted' });
  });

  it('skips a review with no connection / external id (not postable)', async () => {
    const reviewId = '49177777-7777-4777-8491-a00000000002';
    const responseId = '49188888-8888-4888-8491-a00000000002';
    await seedReviewWithResponse({ reviewId, responseId, externalReviewId: null, connectedAccountId: null });

    const res = await postReviewReplyToPlatform({ orgId: orgA, responseId }, deps);
    expect(res).toMatchObject({ posted: false, reason: 'not_postable' });
  });
});
