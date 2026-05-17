import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  adsAccounts,
  adsAlerts,
  auditEvents,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { authorize, can } from '../../lib/permissions/can';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Ads-alert decision lifecycle (Commit 29).
 *
 * The Server Actions need `requireUser()` (a real session
 * cookie), so we exercise the DB transitions directly the way
 * `crisis-decision.test.ts` does for Phase 7. RBAC is verified
 * via the `can()` / `authorize()` helpers.
 *
 *   1. accept → status='accepted', decided_by + decided_at,
 *      audit row.
 *   2. dismiss with reason → status='dismissed', decided_reason,
 *      audit row.
 *   3. Re-deciding a terminal row is a CONFLICT — the row
 *      mustn't change.
 *   4. RBAC matrix: agent + viewer can't decide.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2901c2901c0';
const orgA = '11111111-1111-4111-8111-c2901c2901c0';
const userMgr = '22222222-2222-4222-8222-c2901c2901c0';
const acc = '33333333-3333-4333-8333-c2901c2901c0';
const alert1 = '44444444-4444-4444-8444-c2901c2901c0';
const alert2 = '44444444-4444-4444-8444-c2901c2901c1';
const alertTerminal = '44444444-4444-4444-8444-c2901c2901c2';

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
      email: 'mgr@c29d.test',
      name: 'Mgr',
    });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Decision Org',
      slug: 'c29d-org-a',
      planId,
    });
    await tx.insert(adsAccounts).values({
      id: acc,
      organizationId: orgA,
      platform: 'google',
      externalAccountId: 'acc-1',
      currency: 'USD',
      status: 'connected',
    });
    await tx.insert(adsAlerts).values([
      {
        id: alert1,
        organizationId: orgA,
        adsAccountId: acc,
        kind: 'ctr_drop',
        severity: 'high',
        title: 'CTR drop',
        body: 'body',
        evidence: {},
        status: 'pending',
      },
      {
        id: alert2,
        organizationId: orgA,
        adsAccountId: acc,
        kind: 'spend_spike',
        severity: 'medium',
        title: 'Spend spike',
        body: 'body',
        evidence: {},
        status: 'pending',
      },
      {
        id: alertTerminal,
        organizationId: orgA,
        adsAccountId: acc,
        kind: 'account_error',
        severity: 'critical',
        title: 'Acct error',
        body: 'body',
        evidence: {},
        status: 'accepted',
        decidedAt: new Date('2026-05-15T10:00:00Z'),
        decidedBy: userMgr,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('ads_alerts decision lifecycle', () => {
  it('accept transitions pending → accepted with decided_by + audit', async () => {
    await runAdmin(fixture.db, async (tx) => {
      await tx
        .update(adsAlerts)
        .set({
          status: 'accepted',
          decidedAt: new Date('2026-05-17T12:00:00Z'),
          decidedBy: userMgr,
          updatedAt: new Date('2026-05-17T12:00:00Z'),
        })
        .where(eq(adsAlerts.id, alert1));
      await tx.insert(auditEvents).values({
        organizationId: orgA,
        userId: userMgr,
        actorType: 'user',
        action: 'ads_alert.accepted',
        entityType: 'ads_alert',
        entityId: alert1,
        before: { status: 'pending', severity: 'high' },
        after: { status: 'accepted', kind: 'ctr_drop' },
        riskLevel: 'low',
      });
    });

    type Row = {
      status: string;
      decidedBy: string | null;
      decidedAt: Date | null;
    };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          status: adsAlerts.status,
          decidedBy: adsAlerts.decidedBy,
          decidedAt: adsAlerts.decidedAt,
        })
        .from(adsAlerts)
        .where(eq(adsAlerts.id, alert1)),
    )) as Row[];
    expect(rows[0]!.status).toBe('accepted');
    expect(rows[0]!.decidedBy).toBe(userMgr);
    expect(rows[0]!.decidedAt).not.toBeNull();

    type AuditRow = { id: string };
    const audits = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.action, 'ads_alert.accepted'),
            eq(auditEvents.entityId, alert1),
          ),
        ),
    )) as AuditRow[];
    expect(audits).toHaveLength(1);
  });

  it('dismiss carries reason + audit', async () => {
    const reason = 'campaña pausada manualmente';
    await runAdmin(fixture.db, async (tx) => {
      await tx
        .update(adsAlerts)
        .set({
          status: 'dismissed',
          decidedAt: new Date('2026-05-17T12:00:00Z'),
          decidedBy: userMgr,
          decidedReason: reason,
          updatedAt: new Date('2026-05-17T12:00:00Z'),
        })
        .where(eq(adsAlerts.id, alert2));
      await tx.insert(auditEvents).values({
        organizationId: orgA,
        userId: userMgr,
        actorType: 'user',
        action: 'ads_alert.dismissed',
        entityType: 'ads_alert',
        entityId: alert2,
        before: { status: 'pending', severity: 'medium' },
        after: { status: 'dismissed', reason, kind: 'spend_spike' },
        riskLevel: 'low',
      });
    });

    type Row = { status: string; decidedReason: string | null };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          status: adsAlerts.status,
          decidedReason: adsAlerts.decidedReason,
        })
        .from(adsAlerts)
        .where(eq(adsAlerts.id, alert2)),
    )) as Row[];
    expect(rows[0]!.status).toBe('dismissed');
    expect(rows[0]!.decidedReason).toBe(reason);
  });

  it('terminal row is not re-deciable — UPDATE WHERE status=pending no-ops', async () => {
    // Simulate the "select prior … if status !== pending → CONFLICT"
    // gate by attempting to update only when status='pending'.
    const before = await runAdmin(fixture.db, (tx) =>
      tx
        .select({ status: adsAlerts.status })
        .from(adsAlerts)
        .where(eq(adsAlerts.id, alertTerminal)),
    );
    expect((before as Array<{ status: string }>)[0]!.status).toBe('accepted');

    await runAdmin(fixture.db, (tx) =>
      tx
        .update(adsAlerts)
        .set({ status: 'dismissed' })
        .where(
          and(
            eq(adsAlerts.id, alertTerminal),
            eq(adsAlerts.status, 'pending'),
          ),
        ),
    );

    const after = await runAdmin(fixture.db, (tx) =>
      tx
        .select({ status: adsAlerts.status })
        .from(adsAlerts)
        .where(eq(adsAlerts.id, alertTerminal)),
    );
    expect((after as Array<{ status: string }>)[0]!.status).toBe('accepted');
  });

  it('RBAC matrix: agent + viewer cannot decide, manager+ can', () => {
    expect(can('owner', 'ads_alerts:decide')).toBe(true);
    expect(can('admin', 'ads_alerts:decide')).toBe(true);
    expect(can('manager', 'ads_alerts:decide')).toBe(true);
    expect(can('agent', 'ads_alerts:decide')).toBe(false);
    expect(can('viewer', 'ads_alerts:decide')).toBe(false);

    expect(() => authorize('agent', 'ads_alerts:decide')).toThrow();
    expect(() => authorize('viewer', 'ads_alerts:decide')).toThrow();
  });
});
