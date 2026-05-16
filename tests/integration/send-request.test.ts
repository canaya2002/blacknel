import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import {
  auditEvents,
  brands,
  locations,
  organizations,
  plans,
  reviewRequests,
  users,
} from '../../lib/db/schema';
import { PLANS } from '../../lib/plans/plans';
import {
  cancelReviewRequest,
  sendReviewRequest,
  sendReviewRequestsBulk,
  type RequestDeps,
} from '../../lib/reviews/send-request';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * `sendReviewRequest` + bulk variant. Mirrors the
 * send-reply / send-response test patterns: DI bag wired to the
 * fixture pglite, then exercises the orchestrator paths directly.
 *
 * What's locked in:
 *
 *   1. Happy path inserts a row with the right token + email outbox
 *      gets the request.
 *   2. Plan limit returns PLAN_LIMIT_REACHED with current/cap meta.
 *   3. Duplicate-within-30-days returns DUPLICATE_REVIEW_REQUEST
 *      with the existing requestId.
 *   4. Bulk send partitions correctly (sent + skipped duplicates +
 *      limited by plan cap).
 *   5. Cancel marks a request as no_response.
 *   6. Audit rows match each branch.
 */

let fixture: TestDb;

const planStandardId = '00000000-0000-4000-8000-fe0000000b01';
const planEnterpriseId = '00000000-0000-4000-8000-fe0000000b02';
const orgStandard = '11111111-1111-4111-8111-fe0000000b01';
const orgEnterprise = '11111111-1111-4111-8111-fe0000000b02';
const userA = '22222222-2222-4222-8222-fe0000000b01';
const brandStd = '33333333-3333-4333-8333-fe0000000b01';
const brandA = '33333333-3333-4333-8333-fe0000000b02';
const locationStdId = '44444444-4444-4444-8444-fe0000000b01';
const locationEntId = '44444444-4444-4444-8444-fe0000000b02';

const FIXED_NOW = new Date('2026-05-15T12:00:00Z');

function deterministicTokenFactory(): () => string {
  let n = 0;
  return () => {
    n += 1;
    // Pad to 32 base64url chars after the prefix.
    const suffix = `t${n}`.padStart(32, '0');
    return `bnf_${suffix}`;
  };
}

function depsWith(now: Date): {
  deps: RequestDeps;
  emailSpy: ReturnType<typeof vi.fn>;
} {
  const emailSpy = vi.fn(async () => ({ ok: true, id: 'dev-1' }));
  const deps: RequestDeps = {
    asUser: <T,>(ctx: { orgId: string; userId: string }, fn: (tx: AnyPgTx) => Promise<T>) =>
      runAs(fixture.db, ctx, fn),
    asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    sendEmail: emailSpy as unknown as RequestDeps['sendEmail'],
    generateToken: deterministicTokenFactory(),
    now: () => now,
  };
  return { deps, emailSpy };
}

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values([
      // Standard with a tiny cap so the limit test fits in 2 rows.
      {
        id: planStandardId,
        code: 'standard',
        name: 'Standard',
        priceCents: 6900,
        limits: { reviewRequestsPerMonth: 2 },
      },
      {
        id: planEnterpriseId,
        code: 'enterprise',
        name: 'Enterprise',
        priceCents: 109900,
      },
    ]);
    await tx.insert(users).values({ id: userA, email: 'a@sr.test', name: 'A' });
    await tx.insert(organizations).values([
      {
        id: orgStandard,
        name: 'Org Std',
        slug: 'sr-org-std',
        planId: planStandardId,
      },
      {
        id: orgEnterprise,
        name: 'Org Ent',
        slug: 'sr-org-ent',
        planId: planEnterpriseId,
      },
    ]);
    await tx.insert(brands).values([
      {
        id: brandStd,
        organizationId: orgStandard,
        name: 'Trattoria Std',
        slug: 'trattoria-std',
      },
      {
        id: brandA,
        organizationId: orgEnterprise,
        name: 'Trattoria',
        slug: 'trattoria',
      },
    ]);
    // Two locations: one in the standard-plan org, one in the
    // enterprise-plan org. brand_id ⊆ enterprise org → location
    // brand link uses brandA for both; that's fine for the test
    // because the orchestrator doesn't validate brand-org parentage.
    await tx.insert(locations).values([
      {
        id: locationStdId,
        organizationId: orgStandard,
        brandId: brandStd,
        name: 'Std Location',
        country: 'MX',
      },
      {
        id: locationEntId,
        organizationId: orgEnterprise,
        brandId: brandA,
        name: 'Ent Location',
        country: 'MX',
      },
    ]);
  });
}, 60_000);

beforeEach(async () => {
  // Per-test counter + request hygiene: drop usage counters and the
  // request rows so the dedup window doesn't bleed across tests.
  await runAdmin(fixture.db, async (tx) => {
    await tx.execute(sql`DELETE FROM usage_counters`);
    await tx.execute(sql`DELETE FROM review_requests`);
    await tx.execute(sql`DELETE FROM audit_events`);
  });
});

afterAll(async () => {
  await fixture.dispose();
});

describe('sendReviewRequest — happy path', () => {
  it('inserts the request, mints a token, increments usage, emits an email + audit', async () => {
    const { deps, emailSpy } = depsWith(FIXED_NOW);
    const result = await sendReviewRequest(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipient: { email: 'cliente@demo.com', name: 'Ana' },
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.token).toMatch(/^bnf_/);

    const [row] = await runAdmin<
      Array<{ token: string; contactInfo: unknown; sentAt: Date | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          token: reviewRequests.token,
          contactInfo: reviewRequests.contactInfo,
          sentAt: reviewRequests.sentAt,
        })
        .from(reviewRequests)
        .where(eq(reviewRequests.id, result.data.requestId)),
    );
    expect(row?.token).toBe(result.data.token);
    expect(row?.sentAt).toBeInstanceOf(Date);

    expect(emailSpy).toHaveBeenCalledTimes(1);
    const emailArg = emailSpy.mock.calls[0]?.[0] as { to: string; kind: string };
    expect(emailArg.to).toBe('cliente@demo.com');
    expect(emailArg.kind).toBe('review_request');

    const audit = await runAdmin<Array<{ action: string }>>(
      fixture.db,
      async (tx) =>
        tx.select({ action: auditEvents.action }).from(auditEvents),
    );
    expect(audit.some((a) => a.action === 'review.request.sent')).toBe(true);
  });
});

describe('sendReviewRequest — plan limit', () => {
  it('returns PLAN_LIMIT_REACHED when monthly cap is exceeded', async () => {
    const { deps } = depsWith(FIXED_NOW);
    const cap = PLANS.standard.limits.reviewRequestsPerMonth;
    // Burn the entire plan cap. Tokens are deterministic per-call so
    // the loop doesn't collide; emails are unique per iteration.
    for (let i = 0; i < cap; i++) {
      const r = await sendReviewRequest(
        { orgId: orgStandard, userId: userA, plan: 'standard' },
        {
          brandId: brandStd,
          locationId: locationStdId,
          recipient: { email: `seat${i}@demo.com` },
        },
        deps,
      );
      expect(r.ok).toBe(true);
    }
    const blocked = await sendReviewRequest(
      { orgId: orgStandard, userId: userA, plan: 'standard' },
      {
        brandId: brandStd,
        locationId: locationStdId,
        recipient: { email: 'overflow@demo.com' },
      },
      deps,
    );
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('unreachable');
    expect(blocked.error.code).toBe('PLAN_LIMIT_REACHED');
  });
});

describe('sendReviewRequest — dedup', () => {
  it('returns DUPLICATE_REVIEW_REQUEST for the same email+location inside 30 days', async () => {
    const { deps } = depsWith(FIXED_NOW);
    const first = await sendReviewRequest(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipient: { email: 'repeat@demo.com' },
      },
      deps,
    );
    expect(first.ok).toBe(true);

    const dup = await sendReviewRequest(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipient: { email: 'repeat@demo.com' },
      },
      deps,
    );
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error('unreachable');
    expect(dup.error.code).toBe('DUPLICATE_REVIEW_REQUEST');
    expect(dup.error.meta?.existingRequestId).toBeDefined();
  });

  it('does NOT dedup when the prior request was sent more than 30 days ago', async () => {
    const oldNow = new Date('2026-04-01T12:00:00Z');
    const newNow = new Date('2026-05-15T12:00:00Z'); // 44 days later
    // Share the token factory so the two deps instances don't both
    // mint `bnf_t1...` and trip the global-unique constraint.
    const sharedFactory = deterministicTokenFactory();
    const oldDeps = { ...depsWith(oldNow).deps, generateToken: sharedFactory };
    const newDeps = { ...depsWith(newNow).deps, generateToken: sharedFactory };

    const first = await sendReviewRequest(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipient: { email: 'long-ago@demo.com' },
      },
      oldDeps,
    );
    expect(first.ok).toBe(true);

    const second = await sendReviewRequest(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipient: { email: 'long-ago@demo.com' },
      },
      newDeps,
    );
    expect(second.ok).toBe(true);
  });
});

describe('sendReviewRequestsBulk', () => {
  it('partitions recipients into sent + skipped (dup) + limited (plan cap)', async () => {
    const { deps } = depsWith(FIXED_NOW);
    const cap = PLANS.standard.limits.reviewRequestsPerMonth;

    // Pre-seed: ONE duplicate-target + (cap - 1) fillers so only ONE
    // seat remains. The batch below sends 3: dup → skipped,
    // fresh1 → sent (last seat), fresh2 → limited.
    await sendReviewRequest(
      { orgId: orgStandard, userId: userA, plan: 'standard' },
      {
        brandId: brandStd,
        locationId: locationStdId,
        recipient: { email: 'dup@demo.com' },
      },
      deps,
    );
    for (let i = 0; i < cap - 2; i++) {
      await sendReviewRequest(
        { orgId: orgStandard, userId: userA, plan: 'standard' },
        {
          brandId: brandStd,
          locationId: locationStdId,
          recipient: { email: `filler${i}@demo.com` },
        },
        deps,
      );
    }

    // One seat left. The batch:
    //   - dup@demo.com   → skipped (duplicate)
    //   - fresh1@demo.com → sent (last seat)
    //   - fresh2@demo.com → limited (plan cap reached)
    const result = await sendReviewRequestsBulk(
      { orgId: orgStandard, userId: userA, plan: 'standard' },
      {
        brandId: brandStd,
        locationId: locationStdId,
        recipients: [
          { email: 'dup@demo.com' },
          { email: 'fresh1@demo.com' },
          { email: 'fresh2@demo.com' },
        ],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.data.sent.map((s) => s.email)).toEqual(['fresh1@demo.com']);
    expect(result.data.skipped.map((s) => s.email)).toEqual(['dup@demo.com']);
    expect(result.data.limited.map((s) => s.email)).toEqual(['fresh2@demo.com']);
  });

  it('dedupes within the batch (same email twice counts as one recipient)', async () => {
    const { deps } = depsWith(FIXED_NOW);
    const result = await sendReviewRequestsBulk(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipients: [
          { email: 'same@demo.com' },
          { email: 'same@demo.com' },
          { email: 'SAME@demo.com' }, // case-different — same after lowercase
        ],
      },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.sent.length).toBe(1);
  });
});

describe('cancelReviewRequest', () => {
  it('marks an in-flight request as outcome=no_response and completed', async () => {
    const { deps } = depsWith(FIXED_NOW);
    const created = await sendReviewRequest(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipient: { email: 'cancel@demo.com' },
      },
      deps,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');

    const cancelled = await cancelReviewRequest(
      { orgId: orgEnterprise, userId: userA },
      created.data.requestId,
      deps,
    );
    expect(cancelled.ok).toBe(true);

    const [row] = await runAdmin<
      Array<{ completedAt: Date | null; outcome: string | null }>
    >(fixture.db, async (tx) =>
      tx
        .select({
          completedAt: reviewRequests.completedAt,
          outcome: reviewRequests.outcome,
        })
        .from(reviewRequests)
        .where(eq(reviewRequests.id, created.data.requestId)),
    );
    expect(row?.completedAt).toBeInstanceOf(Date);
    expect(row?.outcome).toBe('no_response');
  });

  it('returns CONFLICT when the request was already completed', async () => {
    const { deps } = depsWith(FIXED_NOW);
    const created = await sendReviewRequest(
      { orgId: orgEnterprise, userId: userA, plan: 'enterprise' },
      {
        brandId: brandA,
        locationId: locationEntId,
        recipient: { email: 'double-cancel@demo.com' },
      },
      deps,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error('unreachable');

    const first = await cancelReviewRequest(
      { orgId: orgEnterprise, userId: userA },
      created.data.requestId,
      deps,
    );
    expect(first.ok).toBe(true);

    const second = await cancelReviewRequest(
      { orgId: orgEnterprise, userId: userA },
      created.data.requestId,
      deps,
    );
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.error.code).toBe('CONFLICT');
  });
});
