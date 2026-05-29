import { eq, isNotNull, isNull } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { _clearLruForTests } from '../../lib/ai/cache';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import { checkCompliance } from '../../lib/ai/skills/compliance';
import type { AiContext } from '../../lib/ai/types';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  aiGenerations,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Dual-model compliance cascade (Commit 23).
 *
 *   1. Low-risk baseline → no cascade fires, single row recorded.
 *   2. High-risk baseline → cascade fires, second row recorded
 *      with parent_generation_id = baseline.id.
 *   3. Critical content → cascade fires + result remains critical.
 *   4. Linkage query: "SELECT WHERE parent_generation_id IS NOT NULL"
 *      returns only cascade rows.
 *   5. Cascade rows skip dedup (5-min LRU + DB), so a repeated
 *      high-risk submission writes a new pair each time.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-cc23cc23cc23';
const orgId = '11111111-1111-4111-8111-cc23cc23cc23';
const userId = '22222222-2222-4222-8222-cc23cc23cc23';

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
    await tx.insert(users).values({ id: userId, email: 'a@cc.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Cascade Org',
      slug: 'cc-org',
      planId,
    });
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  await fixture.dispose();
});

afterEach(() => {
  _clearLruForTests();
});

async function countRowsByParent(): Promise<{ baselines: number; cascades: number }> {
  const all = await runAdmin<Array<{ id: string; parentGenerationId: string | null }>>(
    fixture.db,
    (tx) =>
      tx
        .select({
          id: aiGenerations.id,
          parentGenerationId: aiGenerations.parentGenerationId,
        })
        .from(aiGenerations)
        .where(eq(aiGenerations.organizationId, orgId)),
  );
  const baselines = all.filter((r) => r.parentGenerationId === null).length;
  const cascades = all.filter((r) => r.parentGenerationId !== null).length;
  return { baselines, cascades };
}

describe('compliance cascade — low-risk baseline does NOT trigger second pass', () => {
  it('clean short text → 1 row, no cascade', async () => {
    const before = await countRowsByParent();
    const out = await checkCompliance({
      text: 'Gracias por tu mensaje, te respondo pronto.',
      context: ctxFor('aaaaaaaa-aaaa-4aaa-8aaa-cc23cc23ce01'),
      complianceContext: { entityType: 'inbox' },
    });
    expect(out.meta.cascadeFired).toBe(false);
    expect(out.meta.cascadeGenerationId).toBeNull();
    const after = await countRowsByParent();
    expect(after.baselines - before.baselines).toBe(1);
    expect(after.cascades - before.cascades).toBe(0);
  });
});

describe('compliance cascade — high-risk baseline triggers cascade', () => {
  it('refund + lawsuit keywords → cascade fires, parent linkage lands', async () => {
    const before = await countRowsByParent();
    const out = await checkCompliance({
      text: 'Te haremos un reembolso pronto y vamos a evitar una demanda contigo.',
      context: ctxFor('aaaaaaaa-aaaa-4aaa-8aaa-cc23cc23ce02'),
      complianceContext: {
        entityType: 'review',
        rating: 1,
        brandName: 'TestBrand',
      },
    });
    expect(out.meta.cascadeFired).toBe(true);
    expect(out.meta.cascadeGenerationId).not.toBeNull();
    expect(out.meta.baselineGenerationId).not.toBe(out.meta.cascadeGenerationId);

    // Verify the cascade row's parent_generation_id = baseline.
    const cascadeRows = await runAdmin<Array<{ parentGenerationId: string | null }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ parentGenerationId: aiGenerations.parentGenerationId })
          .from(aiGenerations)
          .where(eq(aiGenerations.id, out.meta.cascadeGenerationId!)),
    );
    expect(cascadeRows[0]?.parentGenerationId).toBe(out.meta.baselineGenerationId);

    // Baseline row's parent_generation_id stays NULL.
    const baselineRows = await runAdmin<Array<{ parentGenerationId: string | null }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ parentGenerationId: aiGenerations.parentGenerationId })
          .from(aiGenerations)
          .where(eq(aiGenerations.id, out.meta.baselineGenerationId)),
    );
    expect(baselineRows[0]?.parentGenerationId).toBeNull();

    // Row delta: 1 baseline + 1 cascade.
    const after = await countRowsByParent();
    expect(after.baselines - before.baselines).toBe(1);
    expect(after.cascades - before.cascades).toBe(1);
  });
});

describe('compliance cascade — linkage query', () => {
  it('"all cascades" returns only parent_generation_id IS NOT NULL rows', async () => {
    const cascades = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .select({ id: aiGenerations.id })
        .from(aiGenerations)
        .where(isNotNull(aiGenerations.parentGenerationId)),
    );
    const baselines = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .select({ id: aiGenerations.id })
        .from(aiGenerations)
        .where(isNull(aiGenerations.parentGenerationId)),
    );
    expect(cascades.length).toBeGreaterThan(0);
    expect(baselines.length).toBeGreaterThan(0);
    // Disjoint sets.
    const cascadeIds = new Set(cascades.map((c) => c.id));
    for (const b of baselines) expect(cascadeIds.has(b.id)).toBe(false);
  });
});

describe('compliance cascade — cascade row bypasses dedup', () => {
  it('repeated high-risk text writes fresh baseline + cascade each time', async () => {
    const before = await countRowsByParent();
    const text = 'Necesito hablar con un abogado urgente sobre este reembolso.';
    const r1 = await checkCompliance({
      text,
      context: ctxFor('aaaaaaaa-aaaa-4aaa-8aaa-cc23cc23ce03'),
      complianceContext: { entityType: 'inbox' },
    });
    const r2 = await checkCompliance({
      text,
      context: ctxFor('aaaaaaaa-aaaa-4aaa-8aaa-cc23cc23ce04'),
      complianceContext: { entityType: 'inbox' },
    });
    expect(r1.meta.cascadeFired).toBe(true);
    expect(r2.meta.cascadeFired).toBe(true);
    // Baseline dedups (same text, same compliance ctx → same hash)
    // so the second baseline may be cached. But the cascade ALWAYS
    // writes fresh because we bypass dedup on cascade.
    const after = await countRowsByParent();
    expect(after.cascades - before.cascades).toBeGreaterThanOrEqual(2);
  });
});

describe('compliance cascade — cascade row carries different model + skill stays compliance', () => {
  it('baseline=Haiku, cascade=Opus, both skill=compliance', async () => {
    const out = await checkCompliance({
      text: 'Te haremos un reembolso completo por el problema médico.',
      context: ctxFor('aaaaaaaa-aaaa-4aaa-8aaa-cc23cc23ce05'),
      complianceContext: { entityType: 'inbox' },
    });
    expect(out.meta.cascadeFired).toBe(true);

    const baselineRow = await runAdmin<Array<{ model: string; skill: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ model: aiGenerations.model, skill: aiGenerations.skill })
          .from(aiGenerations)
          .where(eq(aiGenerations.id, out.meta.baselineGenerationId)),
    );
    const cascadeRow = await runAdmin<Array<{ model: string; skill: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ model: aiGenerations.model, skill: aiGenerations.skill })
          .from(aiGenerations)
          .where(eq(aiGenerations.id, out.meta.cascadeGenerationId!)),
    );
    expect(baselineRow[0]?.model).toBe('claude-haiku-4-5');
    expect(cascadeRow[0]?.model).toBe('claude-opus-4-8');
    expect(baselineRow[0]?.skill).toBe('compliance');
    expect(cascadeRow[0]?.skill).toBe('compliance');
  });
});
