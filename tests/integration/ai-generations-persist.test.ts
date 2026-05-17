import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { _clearLruForTests } from '../../lib/ai/cache';
import { adapterMock } from '../../lib/ai/adapter-mock';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
  findRecentByHash,
  listGenerationsForOrgWithTx,
} from '../../lib/ai/persistence';
import {
  COMPLIANCE_PROMPT_VERSION,
  COMPLIANCE_SYSTEM_PROMPT_V1,
  COMPLIANCE_USER_TEMPLATE_V1,
} from '../../lib/ai/prompts';
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
 * adapter-mock + persistence end-to-end (Commit 22).
 *
 *   1. `.generate()` writes one `ai_generations` row per call.
 *   2. Same `(orgId, requestHash)` inside the dedup window
 *      returns `cacheHit=true` and does NOT write a second row.
 *   3. Tenant isolation: org B cannot see org A's rows through
 *      RLS (`listGenerationsForOrg`).
 *   4. The `promptVersion` survives the round-trip in
 *      `ai_generations.input.promptVersion` (Ajuste 3).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-aa11aa11aa11';
const orgA = '11111111-1111-4111-8111-aa11aa11aa11';
const orgB = '11111111-1111-4111-8111-aa11aa11aa22';
const userA = '22222222-2222-4222-8222-aa11aa11aa11';
const userB = '22222222-2222-4222-8222-aa11aa11aa22';

const COMPLIANCE_OUTPUT_SCHEMA = z.object({
  safe: z.boolean(),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  flags: z.array(z.string()),
  requiresApproval: z.boolean(),
  reasoning: z.string(),
  matchedKeywords: z.array(z.string()),
});

function ctxFor(orgId: string, userId: string): AiContext {
  return {
    orgId,
    userId,
    actorType: 'user',
    entityType: 'inbox_message',
    entityId: null,
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
      { id: userA, email: 'a@aig.test', name: 'A' },
      { id: userB, email: 'b@aig.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'aig-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'aig-org-b', planId },
    ]);
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  await fixture.dispose();
});

afterEach(() => {
  _clearLruForTests();
});

describe('adapter-mock — writes ai_generations row + dedup + RLS', () => {
  it('writes one row on first call + cacheHit=true on second within window', async () => {
    const text = 'Hola, ¿podrían darme un reembolso?';

    const r1 = await adapterMock.generate({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
      userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', text),
      input: { text },
      outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
      context: ctxFor(orgA, userA),
      cachingHint: 'always',
      promptVersion: COMPLIANCE_PROMPT_VERSION,
    });
    expect(r1.meta.cacheHit).toBe(false);
    expect(r1.meta.via).toBe('mock');
    expect(r1.output.flags).toContain('refund_promise');

    // Same input — dedup hit.
    const r2 = await adapterMock.generate({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
      userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', text),
      input: { text },
      outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
      context: ctxFor(orgA, userA),
      cachingHint: 'always',
      promptVersion: COMPLIANCE_PROMPT_VERSION,
    });
    expect(r2.meta.cacheHit).toBe(true);
    expect(r2.meta.requestHash).toBe(r1.meta.requestHash);

    // DB has exactly 1 row for orgA + this hash.
    const rows = await runAdmin<Array<{ id: string; cacheHit: boolean }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            id: aiGenerations.id,
            cacheHit: aiGenerations.cacheHit,
          })
          .from(aiGenerations)
          .where(eq(aiGenerations.requestHash, r1.meta.requestHash)),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.cacheHit).toBe(false);
  });

  it('records promptVersion in ai_generations.input (Ajuste 3)', async () => {
    const text = 'Versioning roundtrip text';
    const r = await adapterMock.generate({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
      userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', text),
      input: { text },
      outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
      context: ctxFor(orgA, userA),
      cachingHint: 'always',
      promptVersion: COMPLIANCE_PROMPT_VERSION,
    });
    const rows = await runAdmin<Array<{ input: Record<string, unknown> }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ input: aiGenerations.input })
          .from(aiGenerations)
          .where(eq(aiGenerations.id, r.meta.generationId)),
    );
    expect(rows[0]?.input?.promptVersion).toBe(COMPLIANCE_PROMPT_VERSION);
    expect(rows[0]?.input?.via).toBe('mock');
  });

  it('tenant isolation — orgB does NOT see orgA rows via listGenerationsForOrg', async () => {
    const text = 'Tenant isolation probe';
    await adapterMock.generate({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
      userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', text),
      input: { text },
      outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
      context: ctxFor(orgA, userA),
      cachingHint: 'always',
      promptVersion: COMPLIANCE_PROMPT_VERSION,
    });

    const listB = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      listGenerationsForOrgWithTx(tx, { orgId: orgB, userId: userB }),
    );
    // No rows visible to orgB.
    expect(listB.length).toBe(0);

    // orgA sees at least one row.
    const listA = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listGenerationsForOrgWithTx(tx, { orgId: orgA, userId: userA }),
    );
    expect(listA.length).toBeGreaterThan(0);
  });

  it('findRecentByHash returns a hit within the window', async () => {
    const text = 'Direct findRecentByHash check';
    const r = await adapterMock.generate({
      skill: 'compliance',
      model: 'claude-haiku-4-5',
      systemPrompt: COMPLIANCE_SYSTEM_PROMPT_V1,
      userPrompt: COMPLIANCE_USER_TEMPLATE_V1.replace('{text}', text),
      input: { text },
      outputSchema: COMPLIANCE_OUTPUT_SCHEMA,
      context: ctxFor(orgA, userA),
      cachingHint: 'always',
      promptVersion: COMPLIANCE_PROMPT_VERSION,
    });
    const hit = await findRecentByHash(orgA, r.meta.requestHash);
    expect(hit).not.toBeNull();
    expect(hit!.meta.cacheHit).toBe(true);
  });
});
