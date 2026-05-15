import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  brandVoices,
  brands,
  locations,
  organizationMembers,
  organizations,
  plans,
  subscriptions,
  users,
} from '../../lib/db/schema';
import { incrementUsage, readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

let fixture: TestDb;

/**
 * The cookie-based onboarding state machine and the Server Actions that
 * back it use `cookies()` from Next, which can't be invoked outside a
 * request. This test exercises the *DB spine* of onboarding — the set of
 * inserts each step performs — to lock in:
 *
 *   1. organization → members → user becomes owner, users counter = 1
 *   2. plan         → subscription created, organizations.plan_id set
 *   3. brand        → brand_voice + brand, brands counter = 1
 *   4. location     → location, locations counter = 1
 *
 * Mirror of the actions in `app/(onboarding)/onboarding/start/actions.ts`.
 * If this goes red, the Server Actions are about to break.
 */

const userId = '22222222-2222-4222-8222-dddddddddddd';
const standardId = '00000000-0000-4000-8000-d00000000001';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: standardId,
      code: 'standard',
      name: 'Standard',
      priceCents: 6900,
    });
    await tx.insert(users).values({
      id: userId,
      email: 'onboarder@test.local',
      name: 'Onboarder',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('onboarding DB spine', () => {
  let createdOrgId: string;
  let createdBrandId: string;

  it('step 1 — creates org + owner membership + bumps users counter', async () => {
    const orgId = await runAdmin<string>(fixture.db, async (tx) => {
      const row = (
        await tx
          .insert(organizations)
          .values({
            name: 'Onboarder Co',
            slug: 'onboarder-co',
            createdBy: userId,
            status: 'active',
          })
          .returning({ id: organizations.id })
      )[0];
      if (!row) throw new Error('insert failed');
      await tx.insert(organizationMembers).values({
        organizationId: row.id,
        userId,
        role: 'owner',
        status: 'active',
      });
      await incrementUsage(tx, row.id, 'users', 1);
      return row.id;
    });

    createdOrgId = orgId;

    const memberCount = await runAdmin(fixture.db, async (tx) =>
      tx
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.organizationId, orgId)),
    );
    expect(memberCount.length).toBe(1);
    expect(memberCount[0]?.role).toBe('owner');

    const usersCount = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, orgId, 'users'),
    );
    expect(usersCount).toBe(1);
  });

  it('step 2 — assigns plan + creates active subscription', async () => {
    await runAdmin(fixture.db, async (tx) => {
      await tx
        .update(organizations)
        .set({ planId: standardId })
        .where(eq(organizations.id, createdOrgId));
      await tx.insert(subscriptions).values({
        organizationId: createdOrgId,
        planId: standardId,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    });

    const orgRow = await runAdmin(fixture.db, async (tx) =>
      tx
        .select({ planId: organizations.planId })
        .from(organizations)
        .where(eq(organizations.id, createdOrgId))
        .limit(1),
    );
    expect(orgRow[0]?.planId).toBe(standardId);

    const subs = await runAdmin(fixture.db, async (tx) =>
      tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.organizationId, createdOrgId)),
    );
    expect(subs.length).toBe(1);
    expect(subs[0]?.status).toBe('active');
  });

  it('step 3 — creates brand + voice and bumps brands counter', async () => {
    const brandId = await runAdmin<string>(fixture.db, async (tx) => {
      const voice = (
        await tx
          .insert(brandVoices)
          .values({
            organizationId: createdOrgId,
            name: 'Default voice',
          })
          .returning({ id: brandVoices.id })
      )[0];
      const brand = (
        await tx
          .insert(brands)
          .values({
            organizationId: createdOrgId,
            name: 'Onboarder Brand',
            slug: 'onboarder-brand',
            brandVoiceId: voice?.id ?? null,
            status: 'active',
          })
          .returning({ id: brands.id })
      )[0];
      await incrementUsage(tx, createdOrgId, 'brands', 1);
      return brand!.id;
    });

    createdBrandId = brandId;

    const brandsCount = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, createdOrgId, 'brands'),
    );
    expect(brandsCount).toBe(1);
  });

  it('step 4 — creates location + bumps locations counter', async () => {
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(locations).values({
        organizationId: createdOrgId,
        brandId: createdBrandId,
        name: 'Centro',
        city: 'CDMX',
        country: 'MX',
        timezone: 'America/Mexico_City',
        status: 'active',
      });
      await incrementUsage(tx, createdOrgId, 'locations', 1);
    });

    const locCount = await runAdmin<number>(fixture.db, async (tx) =>
      readUsage(tx, createdOrgId, 'locations'),
    );
    expect(locCount).toBe(1);
  });
});
