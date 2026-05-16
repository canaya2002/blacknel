import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  approvals,
  auditEvents,
  brands,
  brandVoices,
  connectedAccounts,
  organizations,
  plans,
  postTargets,
  posts,
  users,
} from '../../lib/db/schema';
import {
  applySchedule,
  type ApplyScheduleDeps,
} from '../../lib/publish/composer/apply-schedule';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Approval-rule routing contract (D-19-1, Commit 19c.3).
 *
 *   1. No rules → direct transition (draft → scheduled).
 *   2. `requireApprovalForPosts: true` → routes to
 *      `pending_approval` + creates `approvals` row +
 *      audit `post.routed_to_approval` with `reason='brand_rule'`.
 *   3. `requireApprovalForPostsOnPlatforms: ['facebook']` AND the
 *      post has a FB target → routes to `pending_approval` with
 *      `reason='platform_rule'` + `matchedPlatforms=['facebook']`.
 *   4. Same rule but the post's targets are all OFF the list →
 *      direct transition.
 */

let fixture: TestDb;
let deps: ApplyScheduleDeps;

const planId = '00000000-0000-4000-8000-bd00bd00bd00';
const orgNoRules = '11111111-1111-4111-8111-bd00bd00bd01';
const orgBrandRule = '11111111-1111-4111-8111-bd00bd00bd02';
const orgPlatformRule = '11111111-1111-4111-8111-bd00bd00bd03';
const orgPlatformMismatch = '11111111-1111-4111-8111-bd00bd00bd04';
const userId = '22222222-2222-4222-8222-bd00bd00bd00';

interface Bundle {
  org: string;
  brand: string;
  voice: string;
  campaign: string;
  account: string;
  post: string;
}

function bundle(suffix: string, orgId: string): Bundle {
  // suffix is 3 hex chars; `${suffix}1` makes 4, paired with the
  // 8-char `bd00bd00` prefix → 12 chars total (UUID last segment).
  return {
    org: orgId,
    brand: `33333333-3333-4333-8333-bd00bd00${suffix}1`,
    voice: `44444444-4444-4444-8444-bd00bd00${suffix}2`,
    campaign: `55555555-5555-4555-8555-bd00bd00${suffix}3`,
    account: `66666666-6666-4666-8666-bd00bd00${suffix}4`,
    post: `77777777-7777-4777-8777-bd00bd00${suffix}5`,
  };
}

const A = bundle('aa0', orgNoRules);
const B = bundle('bb0', orgBrandRule);
const C = bundle('cc0', orgPlatformRule);
const D = bundle('dd0', orgPlatformMismatch);

beforeAll(async () => {
  fixture = await createTestDb();
  deps = {
    asUser: <T,>(
      ctx: { orgId: string; userId: string },
      fn: (tx: AnyPgTx) => Promise<T>,
    ) => runAs(fixture.db, ctx, fn),
    asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  };
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userId, email: 'a@ar.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: A.org, name: 'No-rules', slug: 'ar-org-a', planId },
      { id: B.org, name: 'Brand rule', slug: 'ar-org-b', planId },
      { id: C.org, name: 'Platform rule', slug: 'ar-org-c', planId },
      { id: D.org, name: 'Platform mismatch', slug: 'ar-org-d', planId },
    ]);

    // Brand voices — different metadata per org.
    await tx.insert(brandVoices).values([
      { id: A.voice, organizationId: A.org, name: 'No rules', metadata: {} },
      {
        id: B.voice,
        organizationId: B.org,
        name: 'Brand rule',
        metadata: { approvalRules: { requireApprovalForPosts: true } },
      },
      {
        id: C.voice,
        organizationId: C.org,
        name: 'Platform rule',
        metadata: {
          approvalRules: { requireApprovalForPostsOnPlatforms: ['facebook'] },
        },
      },
      {
        id: D.voice,
        organizationId: D.org,
        name: 'Platform mismatch',
        metadata: {
          approvalRules: { requireApprovalForPostsOnPlatforms: ['facebook'] },
        },
      },
    ]);

    // Brands → voice link.
    await tx.insert(brands).values([
      { id: A.brand, organizationId: A.org, name: 'A', slug: 'ar-a', brandVoiceId: A.voice },
      { id: B.brand, organizationId: B.org, name: 'B', slug: 'ar-b', brandVoiceId: B.voice },
      { id: C.brand, organizationId: C.org, name: 'C', slug: 'ar-c', brandVoiceId: C.voice },
      { id: D.brand, organizationId: D.org, name: 'D', slug: 'ar-d', brandVoiceId: D.voice },
    ]);

    // Connected accounts — A/B/C target FB; D targets X.
    await tx.insert(connectedAccounts).values([
      {
        id: A.account,
        organizationId: A.org,
        brandId: A.brand,
        platform: 'facebook',
        externalAccountId: 'fb-a',
      },
      {
        id: B.account,
        organizationId: B.org,
        brandId: B.brand,
        platform: 'facebook',
        externalAccountId: 'fb-b',
      },
      {
        id: C.account,
        organizationId: C.org,
        brandId: C.brand,
        platform: 'facebook',
        externalAccountId: 'fb-c',
      },
      {
        id: D.account,
        organizationId: D.org,
        brandId: D.brand,
        platform: 'x',
        externalAccountId: 'x-d',
      },
    ]);

    // Posts — each draft, with a scheduledAt set so we exercise
    // the "scheduled" branch (the publish-now branch is the
    // mirror — same rule routing, different terminal state).
    const scheduledAt = new Date(Date.now() + 60 * 60_000);
    for (const x of [A, B, C, D]) {
      await tx.insert(posts).values({
        id: x.post,
        organizationId: x.org,
        brandId: x.brand,
        authorId: userId,
        status: 'draft',
        text: 'hello',
        scheduledAt,
      });
      await tx.insert(postTargets).values({
        organizationId: x.org,
        postId: x.post,
        connectedAccountId: x.account,
      });
    }
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('applySchedule — approval rule routing', () => {
  it('no rules: post transitions draft → scheduled, no approvals row', async () => {
    const result = await applySchedule(
      { orgId: A.org, userId, postId: A.post },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routedToApproval).toBe(false);
    expect(result.data.to).toBe('scheduled');
    expect(result.data.approvalId).toBeNull();

    const approvalRows = await runAdmin<Array<{ id: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ id: approvals.id })
          .from(approvals)
          .where(eq(approvals.entityId, A.post)),
    );
    expect(approvalRows.length).toBe(0);
  });

  it('requireApprovalForPosts: routes to pending_approval + creates approvals row', async () => {
    const result = await applySchedule(
      { orgId: B.org, userId, postId: B.post },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routedToApproval).toBe(true);
    expect(result.data.to).toBe('pending_approval');
    expect(result.data.approvalDecision.reason).toBe('brand_rule');
    expect(result.data.approvalId).not.toBeNull();

    const approvalRows = await runAdmin<Array<{ id: string; kind: string; status: string; proposedPayload: unknown }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            id: approvals.id,
            kind: approvals.kind,
            status: approvals.status,
            proposedPayload: approvals.proposedPayload,
          })
          .from(approvals)
          .where(eq(approvals.entityId, B.post)),
    );
    expect(approvalRows.length).toBe(1);
    expect(approvalRows[0]?.kind).toBe('post');
    expect(approvalRows[0]?.status).toBe('pending');

    // Audit row with the spec-named action.
    const auditRows = await runAdmin<Array<{ action: string; after: unknown }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ action: auditEvents.action, after: auditEvents.after })
          .from(auditEvents)
          .where(
            sql`${auditEvents.entityId} = ${B.post} AND ${auditEvents.action} = 'post.routed_to_approval'`,
          ),
    );
    expect(auditRows.length).toBe(1);
    expect((auditRows[0]?.after as { reason: string } | null)?.reason).toBe('brand_rule');
  });

  it('platform rule matches FB target: routes to pending_approval with reason=platform_rule', async () => {
    const result = await applySchedule(
      { orgId: C.org, userId, postId: C.post },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routedToApproval).toBe(true);
    expect(result.data.approvalDecision.reason).toBe('platform_rule');
    expect(result.data.approvalDecision.matchedPlatforms).toEqual(['facebook']);
    expect(result.data.to).toBe('pending_approval');
  });

  it('platform rule does NOT match (post targets X only): direct schedule', async () => {
    const result = await applySchedule(
      { orgId: D.org, userId, postId: D.post },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.routedToApproval).toBe(false);
    expect(result.data.to).toBe('scheduled');
    expect(result.data.approvalId).toBeNull();
  });
});
