import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import { organizations, plans, users } from '../../lib/db/schema';
import { PLANS } from '../../lib/plans/plans';
import {
  assertPostsCapWithTx,
  checkPostsCapWithTx,
} from '../../lib/publish/usage-check';
import { incrementUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Section B gate — explicit single-case coverage.
 *
 * `createPostAction` rejects a `scheduled` or `pending_approval`
 * post when the org has consumed its `postsPerMonth` budget for
 * the current period. The action delegates to `assertPostsCap`,
 * so we exercise that wrapper end-to-end with a seeded counter
 * pinned at the Standard plan's cap (30).
 *
 * Why test `assertPostsCap` instead of the action: the action
 * imports `requireUser` (cookie boundary) and `revalidatePath`
 * (Next runtime). Vitest can't provide either without heavy
 * module mocking. Extracting the gate to `assertPostsCap` (this
 * commit) lets the test exercise the exact branch the action
 * takes — same Result shape, same meta payload, same code path.
 */

let fixture: TestDb;

const planStandardId = '00000000-0000-4000-8000-cc00000c001a';
const orgId = '11111111-1111-4111-8111-cc00000c001a';
const userId = '22222222-2222-4222-8222-cc00000c001a';

const STANDARD_CAP = PLANS.standard.limits.postsPerMonth;

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planStandardId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    await tx.insert(users).values({ id: userId, email: 'cap@test', name: 'Cap' });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Cap Org',
      slug: 'cap-org',
      planId: planStandardId,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('composer cap gating — Section B', () => {
  it('rejects with PLAN_LIMIT_REACHED when postsPerMonth is at the Standard cap', async () => {
    // Pin the counter at the cap. `incrementUsage` writes to the
    // current period row.
    await runAdmin(fixture.db, async (tx) =>
      incrementUsage(tx, orgId, 'postsPerMonth', STANDARD_CAP),
    );

    // Sanity: the raw check returns the right shape.
    const cap = await runAdmin(fixture.db, async (tx) =>
      checkPostsCapWithTx(tx, orgId, 'standard'),
    );
    expect(cap.reached).toBe(true);
    expect(cap.current).toBe(STANDARD_CAP);
    expect(cap.cap).toBe(STANDARD_CAP);
    expect(cap.ok).toBe(false);

    // The assertion wrapper used by `createPostAction` returns
    // exactly the Result the user-facing toast renders.
    const gate = await runAdmin(fixture.db, async (tx) =>
      assertPostsCapWithTx(tx, orgId, 'standard'),
    );
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.error.code).toBe('PLAN_LIMIT_REACHED');
      expect(gate.error.meta).toMatchObject({
        current: STANDARD_CAP,
        cap: STANDARD_CAP,
      });
    }
  });
});
