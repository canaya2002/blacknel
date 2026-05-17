import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { _clearLruForTests } from '../../lib/ai/cache';
import { adapterMock } from '../../lib/ai/adapter-mock';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
  getGenerationKpisWithTx,
  listGenerationsForOrgWithTx,
} from '../../lib/ai/persistence';
import {
  COMPLIANCE_PROMPT_VERSION,
  COMPLIANCE_SYSTEM_PROMPT_V1,
  COMPLIANCE_USER_TEMPLATE_V1,
} from '../../lib/ai/prompts';
import type { AiContext } from '../../lib/ai/types';
import { runAdmin, runAs } from '../../lib/db/client';
import { organizations, plans, users } from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * /audit/ai dashboard data path (Commit 22, Ajuste 2).
 *
 * Verifies what the page consumes:
 *   - `listGenerationsForOrg` returns the right slice with the
 *     right shape (the table columns).
 *   - `getGenerationKpis` rolls up costs, counts, cache hit rate.
 *   - Tenant isolation through RLS.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-a1c0a1c0a1c0';
const orgA = '11111111-1111-4111-8111-a1c0a1c0a1c1';
const orgB = '11111111-1111-4111-8111-a1c0a1c0a1c2';
const userA = '22222222-2222-4222-8222-a1c0a1c0a1c1';
const userB = '22222222-2222-4222-8222-a1c0a1c0a1c2';

const SCHEMA = z.object({
  safe: z.boolean(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  flags: z.array(z.string()),
  requiresApproval: z.boolean(),
  reasoning: z.string(),
  matchedKeywords: z.array(z.string()),
});

function ctxFor(orgId: string, userId: string, entityId: string): AiContext {
  return {
    orgId,
    userId,
    actorType: 'user',
    entityType: 'inbox_message',
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
    await tx.insert(users).values([
      { id: userA, email: 'a@aiv.test', name: 'A' },
      { id: userB, email: 'b@aiv.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'aiv-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'aiv-org-b', planId },
    ]);
  });

  // Seed 5 generations for orgA + 2 for orgB.
  _clearLruForTests();
  for (let i = 0; i < 5; i++) {
    await adapterMock.generate({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
      userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', `orgA call ${i}`),
      input: { text: `orgA call ${i}` },
      outputSchema: SCHEMA,
      context: ctxFor(
        orgA,
        userA,
        '55555555-5555-4555-8555-' + i.toString(16).padStart(12, '0'),
      ),
      cachingHint: 'always',
      promptVersion: COMPLIANCE_PROMPT_VERSION,
    });
  }
  for (let i = 0; i < 2; i++) {
    await adapterMock.generate({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
      userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', `orgB call ${i}`),
      input: { text: `orgB call ${i}` },
      outputSchema: SCHEMA,
      context: ctxFor(
        orgB,
        userB,
        '66666666-6666-4666-8666-' + i.toString(16).padStart(12, '0'),
      ),
      cachingHint: 'always',
      promptVersion: COMPLIANCE_PROMPT_VERSION,
    });
  }
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  await fixture.dispose();
});

describe('/audit/ai data path — listGenerationsForOrg', () => {
  it('orgA sees its 5 rows and not orgB rows', async () => {
    const rows = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listGenerationsForOrgWithTx(tx, { orgId: orgA, userId: userA }),
    );
    expect(rows.length).toBe(5);
    expect(rows.every((r) => r.skill === 'compliance')).toBe(true);
    expect(rows.every((r) => r.model === 'claude-haiku-4-5')).toBe(true);
    expect(rows.every((r) => r.promptVersion === COMPLIANCE_PROMPT_VERSION)).toBe(
      true,
    );
  });

  it('orgB sees its 2 rows', async () => {
    const rows = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      listGenerationsForOrgWithTx(tx, { orgId: orgB, userId: userB }),
    );
    expect(rows.length).toBe(2);
  });

  it('rows are ordered created_at DESC (newest first)', async () => {
    const rows = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listGenerationsForOrgWithTx(tx, { orgId: orgA, userId: userA }),
    );
    for (let i = 0; i < rows.length - 1; i++) {
      expect(rows[i]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        rows[i + 1]!.createdAt.getTime(),
      );
    }
  });
});

describe('/audit/ai data path — getGenerationKpis', () => {
  it('rolls up the month: generationsMonth=5 + Haiku is most used', async () => {
    const kpis = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      getGenerationKpisWithTx(tx, orgA),
    );
    expect(kpis.generationsMonth).toBe(5);
    expect(kpis.mostUsedModel).toBe('claude-haiku-4-5');
    expect(kpis.costCentsMonth).toBeGreaterThanOrEqual(0);
    expect(kpis.cacheHitRate).toBeGreaterThanOrEqual(0);
    expect(kpis.cacheHitRate).toBeLessThanOrEqual(1);
  });

  it('orgB rollup shows 2 generations + no cross-tenant leak', async () => {
    const kpis = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      getGenerationKpisWithTx(tx, orgB),
    );
    expect(kpis.generationsMonth).toBe(2);
  });
});
