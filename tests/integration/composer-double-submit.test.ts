import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs, type AnyPgTx } from '../../lib/db/client';
import {
  brands,
  organizations,
  plans,
  posts,
  users,
} from '../../lib/db/schema';
import { createOrFetchDraft } from '../../lib/publish/composer/new-draft';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Ajuste Y — idempotency-key contract for the composer
 * "Nuevo post" CTA.
 *
 * The Client wrapper (`create-post-button.tsx`) generates a
 * fresh UUID per click and threads it into `createDraftAction`.
 * If the action somehow fires twice with the same key — a
 * stuck button, a retry under flaky connectivity, a refresh on
 * `/composer/new?key=…` — the second call must resolve to the
 * SAME `postId`, not insert a duplicate row.
 *
 * This test exercises the orchestrator directly via the DI
 * seam so it doesn't have to mock `requireUser` / `next/cache`.
 * The Server Action `createDraftAction` is a 4-line wrapper
 * around `createOrFetchDraft` (zod validate + delegate +
 * revalidate) so the contract here covers the action's
 * behavior end-to-end.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-cd000000ee01';
const orgId = '11111111-1111-4111-8111-cd000000ee01';
const userId = '22222222-2222-4222-8222-cd000000ee01';
const brandId = '33333333-3333-4333-8333-cd000000ee01';

const idempotencyKeyA = 'aaaaaaaa-cccc-4ddd-8eee-cd000000ee01';
const idempotencyKeyB = 'bbbbbbbb-cccc-4ddd-8eee-cd000000ee02';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    await tx.insert(users).values({ id: userId, email: 'ds@test', name: 'DS' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Double-Submit Org',
      slug: 'ds-org',
      planId,
    });
    await tx.insert(brands).values({
      id: brandId,
      organizationId: orgId,
      name: 'Brand',
      slug: 'ds-brand',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const fixtureDeps = {
  asUser: <T,>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => runAs(fixture.db, ctx, fn),
  asAdmin: <T,>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
};

describe('composer double-submit — idempotency-key (Ajuste Y)', () => {
  it('two calls with the same key resolve to the same postId, second is idempotent', async () => {
    const first = await createOrFetchDraft(
      { orgId, userId, idempotencyKey: idempotencyKeyA, brandId },
      fixtureDeps,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.created).toBe(true);

    const second = await createOrFetchDraft(
      { orgId, userId, idempotencyKey: idempotencyKeyA, brandId },
      fixtureDeps,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.postId).toBe(first.data.postId);
    expect(second.data.created).toBe(false);

    // Confirm exactly one row materialized for the key.
    const rows = await runAdmin<Array<{ id: string }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ id: posts.id })
          .from(posts)
          .where(eq(posts.idempotencyKey, idempotencyKeyA)),
    );
    expect(rows.length).toBe(1);
  });

  it('different keys produce distinct posts', async () => {
    const a = await createOrFetchDraft(
      { orgId, userId, idempotencyKey: idempotencyKeyB },
      fixtureDeps,
    );
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.data.created).toBe(true);

    // Make sure the post for key A is still distinct from the one
    // we just created for key B.
    const allDraftRows = await runAdmin<Array<{ id: string; idempotencyKey: string | null }>>(
      fixture.db,
      async (tx) =>
        tx
          .select({ id: posts.id, idempotencyKey: posts.idempotencyKey })
          .from(posts)
          .where(eq(posts.organizationId, orgId)),
    );
    const byKey = new Map<string, string>();
    for (const r of allDraftRows) {
      if (r.idempotencyKey) byKey.set(r.idempotencyKey, r.id);
    }
    expect(byKey.get(idempotencyKeyA)).toBeDefined();
    expect(byKey.get(idempotencyKeyB)).toBeDefined();
    expect(byKey.get(idempotencyKeyA)).not.toBe(byKey.get(idempotencyKeyB));
  });
});
