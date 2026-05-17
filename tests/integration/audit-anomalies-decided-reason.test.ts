import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  auditAnomalies,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { seedRolePermissions } from '../../lib/db/seed-role-permissions';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 10 / Commit 37 · Ajuste 1 — `decided_reason` DB CHECK.
 *
 * The CHECK constraint `audit_anomalies_decided_reason_when_decided`
 * enforces: when `status != 'pending'`, `decided_reason` must be
 * NOT NULL and length(trim) ≥ 10. This test verifies the DB rejects
 * malformed decisions independently of the Zod layer.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3700c3700c0';
const orgId = '11111111-1111-4111-8111-c3700c3700c0';
const userOwner = '22222222-2222-4222-8222-c3700c3700c0';

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
      email: 'o@c3700.test',
      name: 'Owner',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Anomaly Org',
      slug: 'c3700-anom',
      planId,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('audit_anomalies decided_reason CHECK (Ajuste 1)', () => {
  it('pending row allows NULL decided_reason', async () => {
    const inserted = (await asAdminTx((tx) =>
      tx
        .insert(auditAnomalies)
        .values({
          organizationId: orgId,
          kind: 'off_hours_access',
          evidence: { ok: 1 },
        })
        .returning({ id: auditAnomalies.id }),
    )) as Array<{ id: string }>;
    expect(inserted).toHaveLength(1);
  });

  it('dismissing without reason → DB CHECK fails', async () => {
    const created = (await asAdminTx((tx) =>
      tx
        .insert(auditAnomalies)
        .values({
          organizationId: orgId,
          kind: 'new_ip',
          evidence: { ok: 1 },
        })
        .returning({ id: auditAnomalies.id }),
    )) as Array<{ id: string }>;
    const id = created[0]!.id;
    await expect(
      asAdminTx((tx) =>
        tx
          .update(auditAnomalies)
          .set({
            status: 'dismissed',
            decidedAt: new Date(),
            decidedBy: userOwner,
            // decidedReason intentionally NOT set
          })
          .where(eq(auditAnomalies.id, id)),
      ),
    ).rejects.toThrow();
  });

  it('dismissing with short reason → DB CHECK fails', async () => {
    const created = (await asAdminTx((tx) =>
      tx
        .insert(auditAnomalies)
        .values({
          organizationId: orgId,
          kind: 'mass_export',
          evidence: { ok: 1 },
        })
        .returning({ id: auditAnomalies.id }),
    )) as Array<{ id: string }>;
    const id = created[0]!.id;
    await expect(
      asAdminTx((tx) =>
        tx
          .update(auditAnomalies)
          .set({
            status: 'dismissed',
            decidedAt: new Date(),
            decidedBy: userOwner,
            decidedReason: 'short', // 5 chars < 10
          })
          .where(eq(auditAnomalies.id, id)),
      ),
    ).rejects.toThrow();
  });

  it('dismissing with valid reason ≥10 chars → DB accepts', async () => {
    const created = (await asAdminTx((tx) =>
      tx
        .insert(auditAnomalies)
        .values({
          organizationId: orgId,
          kind: 'off_hours_access',
          evidence: { ok: 1 },
        })
        .returning({ id: auditAnomalies.id }),
    )) as Array<{ id: string }>;
    const id = created[0]!.id;
    await asAdminTx((tx) =>
      tx
        .update(auditAnomalies)
        .set({
          status: 'dismissed',
          decidedAt: new Date(),
          decidedBy: userOwner,
          decidedReason: 'benign — confirmed by user',
        })
        .where(eq(auditAnomalies.id, id)),
    );
    // Read back to confirm the update applied.
    type Row = { status: string; decidedReason: string | null };
    const rows = (await asAdminTx((tx) =>
      tx
        .select({
          status: auditAnomalies.status,
          decidedReason: auditAnomalies.decidedReason,
        })
        .from(auditAnomalies)
        .where(eq(auditAnomalies.id, id)),
    )) as Row[];
    expect(rows[0]!.status).toBe('dismissed');
    expect(rows[0]!.decidedReason).toBe('benign — confirmed by user');
  });
});
