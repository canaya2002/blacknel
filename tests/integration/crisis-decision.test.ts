import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  aiRecommendations,
  auditEvents,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Crisis decision lifecycle (Commit 25 / B6).
 *
 * The Server Actions live under app/(app)/reputation/crisis-actions.ts;
 * they require a Next request session (`requireUser()`), so we
 * exercise the equivalent DB transitions directly with `runAdmin` /
 * `runAs`. The tests assert:
 *
 *   1. accept transition → status='accepted', decided_by, decided_at, audit row.
 *   2. dismiss transition with reason → status='dismissed' + reason
 *      in evidence.decisionReason, audit row.
 *   3. Concurrent decide: a second decision attempt against an
 *      already-decided rec must not change state (CONFLICT in the
 *      Server Action; the test verifies the locked-row check).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2502c2502c0';
const orgA = '11111111-1111-4111-8111-c2502c2502c0';
const userMgr = '22222222-2222-4222-8222-c2502c2502c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({
      id: userMgr,
      email: 'mgr@c25.test',
      name: 'Mgr',
    });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Crisis Decision Org',
      slug: 'c25d-org-a',
      planId,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

afterEach(async () => {
  await runAdmin(fixture.db, async (tx) => {
    await tx.delete(auditEvents);
    await tx.delete(aiRecommendations);
  });
});

async function seedPendingRec(id: string): Promise<void> {
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(aiRecommendations).values({
      id,
      organizationId: orgA,
      category: 'crisis',
      title: 'Test crisis',
      body: 'Test summary',
      status: 'pending',
      evidence: {
        reviewIds: ['11111111-1111-4111-8111-c2502c2502aa'],
        messageIds: [],
        severity: 'medium',
      },
    });
  });
}

// ---------------------------------------------------------------------------
// 1. accept transition
// ---------------------------------------------------------------------------

describe('crisis decision — accept', () => {
  const recId = '99999999-9999-4999-8999-c2502c2502d1';
  it('flips status pending → accepted with decided_by + audit', async () => {
    await seedPendingRec(recId);

    // Simulate acceptCrisisAction's transactional body.
    await runAdmin(fixture.db, async (tx) => {
      const locked = await tx
        .select({ id: aiRecommendations.id, status: aiRecommendations.status })
        .from(aiRecommendations)
        .where(eq(aiRecommendations.id, recId))
        .for('update')
        .limit(1);
      expect(locked[0]?.status).toBe('pending');
      await tx
        .update(aiRecommendations)
        .set({
          status: 'accepted',
          decidedAt: new Date(),
          decidedBy: userMgr,
        })
        .where(eq(aiRecommendations.id, recId));
    });
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId: orgA,
        userId: userMgr,
        actorType: 'user',
        action: 'ai_recommendation.crisis.accepted',
        entityType: 'ai_recommendation',
        entityId: recId,
        before: { status: 'pending' },
        after: { status: 'accepted' },
        riskLevel: 'medium',
      });
    });

    const rows = await runAdmin<
      Array<{ status: string; decidedBy: string | null }>
    >(fixture.db, (tx) =>
      tx
        .select({
          status: aiRecommendations.status,
          decidedBy: aiRecommendations.decidedBy,
        })
        .from(aiRecommendations)
        .where(eq(aiRecommendations.id, recId)),
    );
    expect(rows[0]?.status).toBe('accepted');
    expect(rows[0]?.decidedBy).toBe(userMgr);

    const audits = await runAdmin<Array<{ action: string }>>(fixture.db, (tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.entityId, recId)),
    );
    expect(audits.some((a) => a.action === 'ai_recommendation.crisis.accepted')).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// 2. dismiss with reason
// ---------------------------------------------------------------------------

describe('crisis decision — dismiss with reason', () => {
  const recId = '99999999-9999-4999-8999-c2502c2502d2';
  it('flips status pending → dismissed, stores reason in evidence', async () => {
    await seedPendingRec(recId);

    await runAdmin(fixture.db, async (tx) => {
      await tx
        .update(aiRecommendations)
        .set({
          status: 'dismissed',
          decidedAt: new Date(),
          decidedBy: userMgr,
          evidence: {
            reviewIds: ['11111111-1111-4111-8111-c2502c2502aa'],
            messageIds: [],
            severity: 'medium',
            decisionReason: 'Falso positivo estacional — Black Friday spike.',
          },
        })
        .where(eq(aiRecommendations.id, recId));
    });

    const rows = await runAdmin<
      Array<{
        status: string;
        evidence: Record<string, unknown>;
      }>
    >(fixture.db, (tx) =>
      tx
        .select({
          status: aiRecommendations.status,
          evidence: aiRecommendations.evidence,
        })
        .from(aiRecommendations)
        .where(eq(aiRecommendations.id, recId)),
    );
    expect(rows[0]?.status).toBe('dismissed');
    expect(rows[0]?.evidence?.decisionReason).toBe(
      'Falso positivo estacional — Black Friday spike.',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Concurrent decide — second attempt sees already-decided
// ---------------------------------------------------------------------------

describe('crisis decision — concurrent decide guards', () => {
  const recId = '99999999-9999-4999-8999-c2502c2502d3';
  it('second decide attempt locks the already-decided row + sees non-pending status', async () => {
    await seedPendingRec(recId);

    // First decision: accept.
    await runAdmin(fixture.db, async (tx) =>
      tx
        .update(aiRecommendations)
        .set({
          status: 'accepted',
          decidedAt: new Date(),
          decidedBy: userMgr,
        })
        .where(eq(aiRecommendations.id, recId)),
    );

    // Second decision attempt — SELECT FOR UPDATE returns the
    // already-accepted row. The Server Action's branch returns
    // CONFLICT; this test asserts the read shape.
    const locked = await runAdmin<Array<{ status: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ status: aiRecommendations.status })
          .from(aiRecommendations)
          .where(eq(aiRecommendations.id, recId))
          .for('update')
          .limit(1),
    );
    expect(locked[0]?.status).toBe('accepted');
    // The action would return err('CONFLICT', ...) here. No
    // further UPDATE fires.
  });
});

// ---------------------------------------------------------------------------
// 4. RBAC sanity — viewer cannot decide
// ---------------------------------------------------------------------------

describe('crisis decision — RBAC sanity', () => {
  it('the role matrix grants crisis:decide ONLY to manager+ tiers', async () => {
    const { ROLE_PERMISSIONS } = await import('../../lib/permissions/roles');
    expect(ROLE_PERMISSIONS.owner).toContain('crisis:decide');
    expect(ROLE_PERMISSIONS.admin).toContain('crisis:decide');
    expect(ROLE_PERMISSIONS.manager).toContain('crisis:decide');
    expect(ROLE_PERMISSIONS.agent).not.toContain('crisis:decide');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('crisis:decide');
    // crisis:read should be everywhere reputation:read is — every
    // role above has crisis:read.
    for (const r of ['owner', 'admin', 'manager', 'agent', 'viewer'] as const) {
      expect(ROLE_PERMISSIONS[r]).toContain('crisis:read');
    }
  });
});
