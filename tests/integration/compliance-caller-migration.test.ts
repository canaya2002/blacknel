import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { _clearLruForTests } from '../../lib/ai/cache';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  aiGenerations,
  brands,
  contactProfiles,
  inboxThreads,
  locations,
  organizations,
  plans,
  reviews,
  users,
} from '../../lib/db/schema';
import { sendReplyToThread, type ReplyDeps as InboxReplyDeps } from '../../lib/inbox/send-reply';
import {
  sendReviewResponse,
  type ReplyDeps as ReviewReplyDeps,
} from '../../lib/reviews/send-response';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Commit 23 — verifies the inbox + reviews callers now produce
 * `ai_generations` rows via the async `checkCompliance` path.
 *
 *   1. Inbox send-reply writes ≥1 baseline row (skill='compliance')
 *      with entity_type='inbox_thread' + entity_id=thread.
 *   2. Reviews send-response writes ≥1 baseline row with
 *      entity_type='review' + entity_id=review.
 *   3. Tenant isolation — org B does NOT see org A's rows
 *      through the persistence layer's RLS path.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c0233c0233c0';
const orgA = '11111111-1111-4111-8111-c0233c0233c0';
const orgB = '11111111-1111-4111-8111-c0233c0233c1';
const userA = '22222222-2222-4222-8222-c0233c0233c0';
const userB = '22222222-2222-4222-8222-c0233c0233c1';
const brandA = '33333333-3333-4333-8333-c0233c0233c0';
const brandB = '33333333-3333-4333-8333-c0233c0233c1';
const locationA = '44444444-4444-4444-8444-c0233c0233c0';
const threadA = '55555555-5555-4555-8555-c0233c0233c0';
const contactA = '66666666-6666-4666-8666-c0233c0233c0';
const reviewA = '77777777-7777-4777-8777-c0233c0233c0';

const inboxDeps: InboxReplyDeps = {
  asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
  asAdmin: (fn) => runAdmin(fixture.db, fn),
};
const reviewDeps: ReviewReplyDeps = {
  asUser: <T>(ctx: { orgId: string; userId: string }, fn: (tx: AnyPgTx) => Promise<T>) =>
    runAs(fixture.db, ctx, fn),
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
};

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
      { id: userA, email: 'a@cm.test', name: 'A' },
      { id: userB, email: 'b@cm.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'cm-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'cm-org-b', planId },
    ]);
    await tx.insert(brands).values([
      { id: brandA, organizationId: orgA, name: 'Brand A', slug: 'cm-brand-a' },
      { id: brandB, organizationId: orgB, name: 'Brand B', slug: 'cm-brand-b' },
    ]);
    await tx.insert(locations).values({
      id: locationA,
      organizationId: orgA,
      brandId: brandA,
      name: 'Loc A',
      slug: 'cm-loc-a',
    });
    await tx.insert(contactProfiles).values({
      id: contactA,
      organizationId: orgA,
      platform: 'facebook',
      externalId: 'fb-cm-1',
      displayName: 'Cliente',
    });
    await tx.insert(inboxThreads).values({
      id: threadA,
      organizationId: orgA,
      contactProfileId: contactA,
      platform: 'facebook',
      kind: 'dm',
      externalThreadId: 'thr-cm-1',
      lastMessageAt: new Date(),
      status: 'open',
    });
    await tx.insert(reviews).values({
      id: reviewA,
      organizationId: orgA,
      brandId: brandA,
      locationId: locationA,
      platform: 'gbp',
      externalReviewId: 'gbp-cm-1',
      authorName: 'Carlos',
      rating: 5,
      body: 'Excellent!',
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

describe('inbox send-reply — writes ai_generations baseline', () => {
  it('produces a compliance baseline row with the correct entity context', async () => {
    const result = await sendReplyToThread(
      { orgId: orgA, userId: userA },
      {
        threadId: threadA,
        messageBody: 'Gracias por contactarnos.',
      },
      inboxDeps,
    );
    expect(result.ok).toBe(true);

    const rows = await runAdmin<
      Array<{ skill: string; entityType: string; entityId: string | null }>
    >(fixture.db, (tx) =>
      tx
        .select({
          skill: aiGenerations.skill,
          entityType: aiGenerations.entityType,
          entityId: aiGenerations.entityId,
        })
        .from(aiGenerations)
        .where(eq(aiGenerations.organizationId, orgA)),
    );
    const complianceRows = rows.filter(
      (r) => r.skill === 'compliance' && r.entityType === 'inbox_thread',
    );
    expect(complianceRows.length).toBeGreaterThan(0);
    expect(complianceRows.some((r) => r.entityId === threadA)).toBe(true);
  });
});

describe('reviews send-response — writes ai_generations baseline', () => {
  it('produces a compliance baseline row tagged with entityType=review', async () => {
    const result = await sendReviewResponse(
      { orgId: orgA, userId: userA },
      {
        reviewId: reviewA,
        body: '¡Gracias por tu reseña, Carlos!',
        mode: 'send',
        aiGenerated: false,
        idempotencyKey: '99999999-9999-4999-8999-c0233c0233c0',
      },
      reviewDeps,
    );
    expect(result.ok).toBe(true);

    const rows = await runAdmin<
      Array<{ skill: string; entityType: string; entityId: string | null }>
    >(fixture.db, (tx) =>
      tx
        .select({
          skill: aiGenerations.skill,
          entityType: aiGenerations.entityType,
          entityId: aiGenerations.entityId,
        })
        .from(aiGenerations)
        .where(eq(aiGenerations.organizationId, orgA)),
    );
    const reviewCompliance = rows.filter(
      (r) => r.skill === 'compliance' && r.entityType === 'review',
    );
    expect(reviewCompliance.length).toBeGreaterThan(0);
    expect(reviewCompliance.some((r) => r.entityId === reviewA)).toBe(true);
  });
});

describe('tenant isolation — orgB does NOT see orgA compliance rows', () => {
  it('runAs as orgB returns zero rows from listGenerationsForOrgWithTx for orgA data', async () => {
    const rows = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) =>
        tx
          .select({ id: aiGenerations.id })
          .from(aiGenerations)
          .where(eq(aiGenerations.organizationId, orgA)),
    );
    // RLS bounces — orgB session can't read orgA rows.
    expect(rows.length).toBe(0);
  });
});
