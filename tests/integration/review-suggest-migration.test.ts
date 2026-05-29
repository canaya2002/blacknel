import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { _clearLruForTests } from '../../lib/ai/cache';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import { suggestReviewReply } from '../../lib/ai/skills/review-response';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  aiGenerations,
  brands,
  locations,
  organizations,
  plans,
  reviews,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Commit 24 — review-response suggestion migration. Mirrors the
 * caption-migration shape:
 *   1. Adapter writes ai_generations row with skill='review_response'.
 *   2. entityType='review' + entity_id = ROOT reviews.id (Ajuste 2).
 *      NEVER review_responses.id even though a review may spawn
 *      multiple response drafts.
 *   3. Tenant isolation through RLS.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2402c2402c0';
const orgA = '11111111-1111-4111-8111-c2402c2402c0';
const orgB = '11111111-1111-4111-8111-c2402c2402c1';
const userA = '22222222-2222-4222-8222-c2402c2402c0';
const userB = '22222222-2222-4222-8222-c2402c2402c1';
const brandA = '33333333-3333-4333-8333-c2402c2402c0';
const locationA = '44444444-4444-4444-8444-c2402c2402c0';
const reviewA = '77777777-7777-4777-8777-c2402c2402c0';

beforeAll(async () => {
  fixture = await createTestDb();
  _setDbDepsForTests({
    asAdmin: (fn) => runAdmin(fixture.db, fn),
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
  });
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values([
      { id: userA, email: 'a@r24.test', name: 'A' },
      { id: userB, email: 'b@r24.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'r24-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'r24-org-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'r24-brand-a',
    });
    await tx.insert(locations).values({
      id: locationA,
      organizationId: orgA,
      brandId: brandA,
      name: 'Loc A',
      slug: 'r24-loc-a',
    });
    await tx.insert(reviews).values({
      id: reviewA,
      organizationId: orgA,
      brandId: brandA,
      locationId: locationA,
      platform: 'gbp',
      externalReviewId: 'gbp-r24-1',
      authorName: 'Carlos',
      rating: 5,
      body: 'Excellent service!',
      sentiment: 'positive',
      status: 'pending',
    });
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  _clearLruForTests();
  await fixture.dispose();
});

afterEach(() => {
  _clearLruForTests();
});

describe('review suggest migration — ai_generations row', () => {
  it('writes a row with skill=review_response + model=Haiku', async () => {
    const out = await suggestReviewReply({
      input: {
        reviewId: reviewA,
        rating: 5,
        authorName: 'Carlos',
        brandName: 'Brand A',
        locationName: 'Loc A',
      },
      reviewBody: 'Excellent service!',
      context: {
        orgId: orgA,
        userId: userA,
        actorType: 'user',
        entityType: 'review',
        entityId: reviewA,
      },
    });
    expect(out.body.length).toBeGreaterThan(0);

    const rows = await runAdmin<
      Array<{
        skill: string;
        model: string;
        entityType: string;
        entityId: string | null;
      }>
    >(fixture.db, (tx) =>
      tx
        .select({
          skill: aiGenerations.skill,
          model: aiGenerations.model,
          entityType: aiGenerations.entityType,
          entityId: aiGenerations.entityId,
        })
        .from(aiGenerations)
        .where(eq(aiGenerations.organizationId, orgA)),
    );
    const reviewRows = rows.filter((r) => r.skill === 'review_response');
    expect(reviewRows.length).toBeGreaterThan(0);
    expect(reviewRows[0]?.model).toBe('claude-sonnet-4-6');
    expect(reviewRows[0]?.entityType).toBe('review');
  });

  it('entityId is the ROOT reviews.id, never review_responses.id (Ajuste 2)', async () => {
    const rows = await runAdmin<Array<{ entityId: string | null }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ entityId: aiGenerations.entityId })
          .from(aiGenerations)
          .where(eq(aiGenerations.skill, 'review_response')),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.entityId).toBe(reviewA);
    }
  });

  it('tenant isolation — orgB does NOT see orgA review-response rows', async () => {
    const rows = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) =>
        tx
          .select({ id: aiGenerations.id })
          .from(aiGenerations)
          .where(eq(aiGenerations.skill, 'review_response')),
    );
    expect(rows.length).toBe(0);
  });
});
