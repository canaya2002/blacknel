import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { _clearLruForTests } from '../../lib/ai/cache';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
  getGenerationKpisWithTx,
  listGenerationsForOrgWithTx,
} from '../../lib/ai/persistence';
import { checkCompliance } from '../../lib/ai/skills/compliance';
import type { AiContext } from '../../lib/ai/types';
import { runAdmin, runAs } from '../../lib/db/client';
import { organizations, plans, users } from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Dashboard cascade-aware surfaces (Commit 23 / Ajuste 3).
 *
 *   1. `cascade=cascade` filter returns only parent-non-null rows.
 *   2. `cascade=baseline` filter returns only parent-null rows.
 *   3. `getGenerationKpis.cascadeRate` reflects (cascade rows) /
 *      (high-risk baseline rows).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-cd23cd23cd23';
const orgId = '11111111-1111-4111-8111-cd23cd23cd23';
const userId = '22222222-2222-4222-8222-cd23cd23cd23';

function ctxFor(entityId: string): AiContext {
  return {
    orgId,
    userId,
    actorType: 'user',
    entityType: 'inbox_thread',
    entityId,
  };
}

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
    await tx.insert(users).values({ id: userId, email: 'a@cd.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Cascade Dashboard Org',
      slug: 'cd-org',
      planId,
    });
  });

  // Seed: 3 high-risk calls (each = 1 baseline + 1 cascade = 6 rows)
  //       + 2 low-risk calls (each = 1 baseline = 2 rows).
  // Total: 8 rows. 3 cascades. 5 baselines. 3 high-risk baselines.
  // Expected cascadeRate = 3 / 3 = 1.0.
  for (let i = 0; i < 3; i++) {
    await checkCompliance({
      text: `Te haremos un reembolso, pasaste por el abogado #${i}`,
      context: ctxFor(`aaaaaaaa-aaaa-4aaa-8aaa-cd23cd23${(0xce00 + i).toString(16).padStart(4, '0')}`),
      complianceContext: { entityType: 'inbox' },
    });
  }
  for (let i = 0; i < 2; i++) {
    await checkCompliance({
      text: `Mensaje normal #${i}, gracias por escribir.`,
      context: ctxFor(`aaaaaaaa-aaaa-4aaa-8aaa-cd23cd23${(0xcf00 + i).toString(16).padStart(4, '0')}`),
      complianceContext: { entityType: 'inbox' },
    });
  }
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  await fixture.dispose();
});

afterEach(() => {
  _clearLruForTests();
});

describe('cascade filter — Solo cascadas / Solo baseline / Todos', () => {
  it('cascade=cascade returns only parent-non-null rows', async () => {
    const rows = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listGenerationsForOrgWithTx(tx, {
        orgId,
        userId,
        cascade: 'cascade',
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.parentGenerationId).not.toBeNull();
    }
  });

  it('cascade=baseline returns only parent-null rows', async () => {
    const rows = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listGenerationsForOrgWithTx(tx, {
        orgId,
        userId,
        cascade: 'baseline',
      }),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.parentGenerationId).toBeNull();
    }
  });

  it('no cascade filter returns mixed set including both kinds', async () => {
    const rows = await runAs(fixture.db, { orgId, userId }, (tx) =>
      listGenerationsForOrgWithTx(tx, { orgId, userId }),
    );
    const cascades = rows.filter((r) => r.parentGenerationId !== null);
    const baselines = rows.filter((r) => r.parentGenerationId === null);
    expect(cascades.length).toBeGreaterThan(0);
    expect(baselines.length).toBeGreaterThan(0);
  });
});

describe('cascadeRate KPI — Ajuste 3', () => {
  it('cascadeRate = 1.0 when every high-risk baseline triggered cascade (mock determinism)', async () => {
    const kpis = await runAs(fixture.db, { orgId, userId }, (tx) =>
      getGenerationKpisWithTx(tx, orgId),
    );
    expect(kpis.cascadeRate).toBe(1);
  });
});
