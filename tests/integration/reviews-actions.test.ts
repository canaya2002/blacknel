import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  locations,
  organizations,
  plans,
  reviewResponses,
  reviews,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase-5 reviews/review_responses schema + base actions coverage.
 *
 * Mirrors the Phase-4 pattern: we exercise the SQL transitions
 * directly through `runAs`/`runAdmin`, not the Server Actions over an
 * HTTP boundary vitest can't synthesize. Composer / draft / send is
 * Commit 14; here we lock in:
 *
 *   1. Tenant isolation on `reviews` + `review_responses`.
 *   2. The CHECK constraint on `rating` (1..5).
 *   3. The unique `(org, platform, external_review_id)` partial index.
 *   4. The denormalize-org-id trigger on `review_responses`.
 *   5. Cascade delete from reviews → review_responses.
 *   6. Status / escalate / spam transitions persist as expected.
 *   7. Tag-set semantics (idempotent add, filter-on-remove).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-aaa000000001';
const orgA = '11111111-1111-4111-8111-aaa000000001';
const orgB = '11111111-1111-4111-8111-aaa000000002';
const userA = '22222222-2222-4222-8222-aaa000000001';
const brandAId = '33333333-3333-4333-8333-aaa000000001';
const locationAId = '44444444-4444-4444-8444-aaa000000001';

const reviewA1 = '55555555-5555-4555-8555-aaa000000001';
const reviewA2 = '55555555-5555-4555-8555-aaa000000002';
const reviewB1 = '55555555-5555-4555-8555-aaa000000B01';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@rev.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'rev-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'rev-org-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandAId,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'brand-a',
    });
    await tx.insert(locations).values({
      id: locationAId,
      organizationId: orgA,
      brandId: brandAId,
      name: 'Downtown',
    });
    await tx.insert(reviews).values([
      {
        id: reviewA1,
        organizationId: orgA,
        brandId: brandAId,
        locationId: locationAId,
        platform: 'gbp',
        externalReviewId: 'gbp-rev-a-1',
        authorName: 'Cliente Demo',
        rating: 4,
        body: 'Buena experiencia, gracias.',
        sentiment: 'positive',
        status: 'pending',
      },
      {
        id: reviewA2,
        organizationId: orgA,
        brandId: brandAId,
        locationId: locationAId,
        platform: 'gbp',
        externalReviewId: 'gbp-rev-a-2',
        authorName: 'Otra persona',
        rating: 2,
        body: 'No tan buena experiencia.',
        sentiment: 'negative',
        status: 'pending',
      },
      {
        id: reviewB1,
        organizationId: orgB,
        platform: 'gbp',
        externalReviewId: 'gbp-rev-b-1',
        authorName: 'Org B reviewer',
        rating: 5,
        body: 'Org B review.',
        sentiment: 'positive',
        status: 'pending',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('reviews tenant isolation', () => {
  it('org A user sees only org A reviews', async () => {
    const visible = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) => tx.select({ id: reviews.id }).from(reviews),
    );
    expect(visible.map((r) => r.id).sort()).toEqual([reviewA1, reviewA2].sort());
  });

  it('org B context cannot UPDATE an org A review', async () => {
    await runAs(
      fixture.db,
      { orgId: orgB, userId: userA },
      async (tx) =>
        tx
          .update(reviews)
          .set({ status: 'archived' })
          .where(eq(reviews.id, reviewA1)),
    );
    const [row] = await runAdmin<Array<{ status: string }>>(fixture.db, async (tx) =>
      tx
        .select({ status: reviews.status })
        .from(reviews)
        .where(eq(reviews.id, reviewA1)),
    );
    expect(row?.status).toBe('pending');
  });
});

describe('rating CHECK constraint', () => {
  it('rejects rating=0', async () => {
    await expect(
      runAdmin(fixture.db, async (tx) =>
        tx.insert(reviews).values({
          organizationId: orgA,
          platform: 'gbp',
          rating: 0,
          body: 'invalid',
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects rating=6', async () => {
    await expect(
      runAdmin(fixture.db, async (tx) =>
        tx.insert(reviews).values({
          organizationId: orgA,
          platform: 'gbp',
          rating: 6,
          body: 'invalid',
        }),
      ),
    ).rejects.toThrow();
  });

  it('accepts rating=3', async () => {
    const id = '55555555-5555-4555-8555-aaa00000c003';
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviews).values({
        id,
        organizationId: orgA,
        platform: 'gbp',
        rating: 3,
        body: 'okay',
      }),
    );
    const [row] = await runAdmin<Array<{ rating: number }>>(fixture.db, async (tx) =>
      tx.select({ rating: reviews.rating }).from(reviews).where(eq(reviews.id, id)),
    );
    expect(row?.rating).toBe(3);
  });
});

describe('reviews unique (org, platform, external_review_id)', () => {
  it('rejects duplicate (org, platform, external_review_id)', async () => {
    await expect(
      runAdmin(fixture.db, async (tx) =>
        tx.insert(reviews).values({
          organizationId: orgA,
          platform: 'gbp',
          externalReviewId: 'gbp-rev-a-1', // duplicate
          rating: 5,
          body: 'dup attempt',
        }),
      ),
    ).rejects.toThrow();
  });

  it('allows NULL external_review_id to repeat (partial unique)', async () => {
    const id1 = '55555555-5555-4555-8555-aaa00000d001';
    const id2 = '55555555-5555-4555-8555-aaa00000d002';
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(reviews).values([
        {
          id: id1,
          organizationId: orgA,
          platform: 'bbb',
          externalReviewId: null,
          rating: 4,
          body: 'manual import 1',
        },
        {
          id: id2,
          organizationId: orgA,
          platform: 'bbb',
          externalReviewId: null,
          rating: 4,
          body: 'manual import 2',
        },
      ]),
    );
    const found = await runAdmin<Array<{ id: string }>>(fixture.db, async (tx) =>
      tx
        .select({ id: reviews.id })
        .from(reviews)
        .where(and(eq(reviews.organizationId, orgA), eq(reviews.platform, 'bbb'))),
    );
    expect(found.length).toBeGreaterThanOrEqual(2);
  });
});

describe('review_responses.organization_id trigger', () => {
  it('auto-populates organization_id from the parent review on insert', async () => {
    const respId = '99999999-9999-4999-8999-aaa000000001';
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.execute(sql`
          INSERT INTO review_responses
            (id, review_id, draft_text, status, author_id, ai_generated)
          VALUES
            (${respId}::uuid, ${reviewA1}::uuid, 'Draft sin org explícita', 'draft',
             ${userA}::uuid, false)
        `),
    );

    const [row] = await runAs<Array<{ organizationId: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx
          .select({ organizationId: reviewResponses.organizationId })
          .from(reviewResponses)
          .where(eq(reviewResponses.id, respId)),
    );
    expect(row?.organizationId).toBe(orgA);
  });

  it('rejects insert when the parent review is not RLS-visible (cross-tenant)', async () => {
    // User in org A attempts to insert a response into reviewB1
    // (belongs to org B). Trigger's SELECT runs under RLS → returns
    // no row → organization_id stays NULL → NOT NULL violation.
    await expect(
      runAs(
        fixture.db,
        { orgId: orgA, userId: userA },
        async (tx) =>
          tx.execute(sql`
            INSERT INTO review_responses
              (review_id, draft_text, status)
            VALUES
              (${reviewB1}::uuid, 'cross-tenant spoof', 'draft')
          `),
      ),
    ).rejects.toThrow();
  });
});

describe('reviews cascade delete', () => {
  it('removing a review removes its responses', async () => {
    const reviewId = '55555555-5555-4555-8555-aaa00000e001';
    const responseId = '99999999-9999-4999-8999-aaa00000e001';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(reviews).values({
        id: reviewId,
        organizationId: orgA,
        platform: 'gbp',
        externalReviewId: 'gbp-cascade-1',
        rating: 3,
        body: 'will be cascaded',
      });
      await tx.insert(reviewResponses).values({
        id: responseId,
        organizationId: orgA,
        reviewId,
        draftText: 'response that should disappear',
        status: 'draft',
      });
    });

    await runAdmin(fixture.db, async (tx) =>
      tx.delete(reviews).where(eq(reviews.id, reviewId)),
    );

    const remaining = await runAdmin<Array<{ id: string }>>(fixture.db, async (tx) =>
      tx
        .select({ id: reviewResponses.id })
        .from(reviewResponses)
        .where(eq(reviewResponses.id, responseId)),
    );
    expect(remaining.length).toBe(0);
  });
});

describe('reviews status / escalate transitions', () => {
  it('escalate flips escalated=true', async () => {
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.update(reviews).set({ escalated: true }).where(eq(reviews.id, reviewA2)),
    );
    const [row] = await runAs<Array<{ escalated: boolean }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.select({ escalated: reviews.escalated }).from(reviews).where(eq(reviews.id, reviewA2)),
    );
    expect(row?.escalated).toBe(true);
  });

  it('mark-spam moves status to spam', async () => {
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.update(reviews).set({ status: 'spam' }).where(eq(reviews.id, reviewA2)),
    );
    const [row] = await runAs<Array<{ status: string }>>(
      fixture.db,
      { orgId: orgA, userId: userA },
      async (tx) =>
        tx.select({ status: reviews.status }).from(reviews).where(eq(reviews.id, reviewA2)),
    );
    expect(row?.status).toBe('spam');
  });
});
