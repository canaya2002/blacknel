import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  auditEvents,
  auditRetentionPolicies,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { runAuditRetentionPurgeTick } from '../../lib/jobs/audit-retention-purge';
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 37 — retention purge cron tick.
 *
 * Verifies the purge cron:
 *   - Deletes events older than the resolved policy threshold.
 *   - Respects precedence (Ajuste 2): exact > prefix > 'all'.
 *   - Emits `audit.retention.purged` audit-of-audit row.
 *   - Skips orgs without any policy.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3702c3702c0';
const orgWithPolicy = '11111111-1111-4111-8111-c3702c3702c0';
const orgWithoutPolicy = '11111111-1111-4111-8111-c3702c3702c1';
const userOwner = '22222222-2222-4222-8222-c3702c3702c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await seedRolePermissions(tx);
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({
      id: userOwner,
      email: 'o@c3702.test',
      name: 'Owner',
    });
    await tx.insert(organizations).values([
      {
        id: orgWithPolicy,
        name: 'With Policy',
        slug: 'c3702-with',
        planId,
      },
      {
        id: orgWithoutPolicy,
        name: 'No Policy',
        slug: 'c3702-no',
        planId,
      },
    ]);

    // Policies for orgWithPolicy:
    //   - 'all' = 30d
    //   - 'billing.*' = 180d
    await tx.insert(auditRetentionPolicies).values([
      {
        organizationId: orgWithPolicy,
        appliesTo: 'all',
        retentionDays: 30,
      },
      {
        organizationId: orgWithPolicy,
        appliesTo: 'billing.*',
        retentionDays: 180,
      },
    ]);

    // Events:
    //   - orgWithPolicy: 'inbox.read' 60d old → should be purged
    //     (all=30d, exceeds).
    //   - orgWithPolicy: 'billing.charge' 60d old → should NOT
    //     (billing.* = 180d, not exceeded).
    //   - orgWithPolicy: 'inbox.read' 10d old → should NOT (within 30d).
    //   - orgWithoutPolicy: 'anything' 1000d old → should NOT
    //     (no policy = never purge).
    const now = Date.now();
    await tx.insert(auditEvents).values([
      {
        organizationId: orgWithPolicy,
        userId: userOwner,
        action: 'inbox.read',
        createdAt: new Date(now - 60 * 86_400_000),
      },
      {
        organizationId: orgWithPolicy,
        userId: userOwner,
        action: 'billing.charge',
        createdAt: new Date(now - 60 * 86_400_000),
      },
      {
        organizationId: orgWithPolicy,
        userId: userOwner,
        action: 'inbox.read',
        createdAt: new Date(now - 10 * 86_400_000),
      },
      {
        organizationId: orgWithoutPolicy,
        userId: userOwner,
        action: 'inbox.read',
        createdAt: new Date(now - 1000 * 86_400_000),
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('audit retention purge tick', () => {
  it('purges expired events respecting policy precedence; protects orgs without policies', async () => {
    const result = await runAuditRetentionPurgeTick({
      deps: { asAdmin: asAdminTx },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.orgsWithPolicies).toBe(1);
    expect(result.data.totalRowsDeleted).toBeGreaterThanOrEqual(1);

    // orgWithPolicy: inbox.read 60d should be gone.
    type Row = { action: string; createdAt: Date };
    const remainingWithPolicy = (await asAdminTx((tx) =>
      tx
        .select({
          action: auditEvents.action,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, orgWithPolicy)),
    )) as Row[];
    const inboxReadOld = remainingWithPolicy.find(
      (r) =>
        r.action === 'inbox.read' &&
        Date.now() - r.createdAt.getTime() > 50 * 86_400_000,
    );
    expect(inboxReadOld).toBeUndefined();
    // billing.charge 60d should still be present (within 180d).
    const billingOld = remainingWithPolicy.find(
      (r) => r.action === 'billing.charge',
    );
    expect(billingOld).toBeDefined();
    // inbox.read 10d still present (within 30d).
    const inboxReadRecent = remainingWithPolicy.find(
      (r) =>
        r.action === 'inbox.read' &&
        Date.now() - r.createdAt.getTime() < 20 * 86_400_000,
    );
    expect(inboxReadRecent).toBeDefined();

    // orgWithoutPolicy: untouched.
    const remainingWithoutPolicy = (await asAdminTx((tx) =>
      tx
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, orgWithoutPolicy)),
    )) as Array<{ action: string }>;
    expect(remainingWithoutPolicy.find((r) => r.action === 'inbox.read')).toBeDefined();

    // Audit-of-audit row was emitted.
    const purgedAudit = (await asAdminTx((tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(
          eq(auditEvents.action, 'audit.retention.purged'),
        ),
    )) as Array<{ organizationId: string | null }>;
    const forOrg = purgedAudit.find((r) => r.organizationId === orgWithPolicy);
    expect(forOrg).toBeDefined();
  });
});
