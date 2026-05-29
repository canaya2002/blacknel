import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { _clearLruForTests } from '../../lib/ai/cache';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import { suggestCaption } from '../../lib/ai/skills/caption';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  aiGenerations,
  brands,
  organizations,
  plans,
  posts,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Commit 24 — caption suggestion migration. Verifies:
 *   1. suggestCaption writes an ai_generations row with
 *      skill='caption' + model='claude-sonnet-4-6' (C43a routing).
 *   2. entityType='post' + entity_id = ROOT posts.id (Ajuste 2).
 *   3. Tenant isolation — orgB cannot read orgA caption rows.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2401c2401c0';
const orgA = '11111111-1111-4111-8111-c2401c2401c0';
const orgB = '11111111-1111-4111-8111-c2401c2401c1';
const userA = '22222222-2222-4222-8222-c2401c2401c0';
const userB = '22222222-2222-4222-8222-c2401c2401c1';
const brandA = '33333333-3333-4333-8333-c2401c2401c0';
const postA = '55555555-5555-4555-8555-c2401c2401c0';

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
      { id: userA, email: 'a@c24.test', name: 'A' },
      { id: userB, email: 'b@c24.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c24-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c24-org-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'c24-brand-a',
    });
    await tx.insert(posts).values({
      id: postA,
      organizationId: orgA,
      brandId: brandA,
      authorId: userA,
      status: 'draft',
      text: 'draft text',
    });
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  _clearLruForTests();
  await fixture.dispose();
});

afterEach(() => {
  _clearLruForTests();
});

describe('caption suggest migration — ai_generations row', () => {
  it('writes a row with skill=caption + model=Haiku', async () => {
    const out = await suggestCaption({
      input: {
        postId: postA,
        brandId: brandA,
        brandName: 'Brand A',
        locationName: null,
        productHint: null,
        goal: 'launch',
        tone: 'friendly',
        index: 0,
      },
      context: {
        orgId: orgA,
        userId: userA,
        actorType: 'user',
        entityType: 'post',
        entityId: postA,
      },
    });
    expect(out.body.length).toBeGreaterThan(0);

    const rows = await runAdmin<
      Array<{
        skill: string;
        model: string;
        entityType: string;
        entityId: string | null;
      }>
    >(fixture.db, (tx) =>
      tx
        .select({
          skill: aiGenerations.skill,
          model: aiGenerations.model,
          entityType: aiGenerations.entityType,
          entityId: aiGenerations.entityId,
        })
        .from(aiGenerations)
        .where(eq(aiGenerations.organizationId, orgA)),
    );
    const captionRows = rows.filter((r) => r.skill === 'caption');
    expect(captionRows.length).toBeGreaterThan(0);
    expect(captionRows[0]?.model).toBe('claude-sonnet-4-6');
    expect(captionRows[0]?.entityType).toBe('post');
  });

  it('entityId is the ROOT posts.id, not derived (Ajuste 2)', async () => {
    const rows = await runAdmin<Array<{ entityId: string | null }>>(
      fixture.db,
      (tx) =>
        tx
          .select({ entityId: aiGenerations.entityId })
          .from(aiGenerations)
          .where(eq(aiGenerations.skill, 'caption')),
    );
    expect(rows.length).toBeGreaterThan(0);
    // Every caption row anchors on the post root id, never a
    // post_target id or a draft text hash.
    for (const r of rows) {
      expect(r.entityId).toBe(postA);
    }
  });

  it('tenant isolation — orgB does NOT see orgA caption rows', async () => {
    const rows = await runAs<Array<{ id: string }>>(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) =>
        tx
          .select({ id: aiGenerations.id })
          .from(aiGenerations)
          .where(eq(aiGenerations.skill, 'caption')),
    );
    expect(rows.length).toBe(0);
  });
});
