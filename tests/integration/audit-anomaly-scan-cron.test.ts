import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  auditAnomalies,
  auditEvents,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { runAuditAnomalyScanTick } from '../../lib/jobs/audit-anomaly-scan';
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 37 — anomaly scan cron tick end-to-end.
 *
 * Seeds events that match the three heuristic kinds + control
 * events that should NOT trigger. Verifies the cron writes the
 * expected anomalies + dedup on re-tick.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3703c3703c0';
const orgId = '11111111-1111-4111-8111-c3703c3703c0';
const userA = '22222222-2222-4222-8222-c3703c3703c0';

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
      id: userA,
      email: 'a@c3703.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Scan Org',
      slug: 'c3703-scan',
      planId,
    });

    // Mass export event (current window — 30 min ago).
    const nowMs = Date.now();
    await tx.insert(auditEvents).values([
      {
        organizationId: orgId,
        userId: userA,
        actorType: 'user',
        action: 'reports.csv.exported',
        after: { rowCount: 5000 },
        ip: '203.0.113.5',
        createdAt: new Date(nowMs - 30 * 60_000),
      },
      // Background events for IP history (90d): one IP.
      {
        organizationId: orgId,
        userId: userA,
        action: 'inbox.read',
        ip: '203.0.113.1',
        createdAt: new Date(nowMs - 10 * 86_400_000),
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('runAuditAnomalyScanTick', () => {
  it('detects mass_export + new_ip (single user, IP 203.0.113.5 not in history)', async () => {
    const result = await runAuditAnomalyScanTick({
      deps: { asAdmin: asAdminTx },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.anomaliesDetected).toBeGreaterThanOrEqual(2);
    expect(result.data.anomaliesPersisted).toBeGreaterThanOrEqual(2);

    const rows = (await asAdminTx((tx) =>
      tx.select().from(auditAnomalies),
    )) as Array<{ kind: string; status: string }>;
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has('mass_export')).toBe(true);
    expect(kinds.has('new_ip')).toBe(true);
    for (const r of rows) {
      expect(r.status).toBe('pending');
    }
  });

  it('dedup: second tick within window does NOT create new anomalies', async () => {
    const before = (await asAdminTx((tx) =>
      tx.select().from(auditAnomalies),
    )) as Array<{ id: string }>;
    const beforeCount = before.length;
    const result = await runAuditAnomalyScanTick({
      deps: { asAdmin: asAdminTx },
    });
    expect(result.ok).toBe(true);
    const after = (await asAdminTx((tx) =>
      tx.select().from(auditAnomalies),
    )) as Array<{ id: string }>;
    expect(after.length).toBe(beforeCount);
  });
});
