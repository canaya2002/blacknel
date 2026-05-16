import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  defaultPublishDashboardDeps,
  loadPublishDashboardDataWithTx,
  type PublishDashboardDeps,
} from '../../lib/publish/dashboard';
import { parsePublishFilters } from '../../lib/publish/filters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Single-pass dashboard guarantee for /publish (Ajuste 3).
 *
 * The page issues exactly one call to `loadPublishDashboardData`.
 * The loader dispatches to each per-card query *exactly once*,
 * except for the calendar projection which is skipped entirely
 * when the active tab isn't `'calendar'`. A future refactor that
 * adds a fetch from inside a component (a cardinal sin in our
 * shape) trips this contract.
 *
 * Production opens its own `dbAs`; that path goes through
 * `getRawDb()` which refuses test runs by design. We exercise the
 * sibling `loadPublishDashboardDataWithTx` which accepts an
 * existing transaction — identical body, identical spy contract.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-dd00000000d1';
const orgA = '11111111-1111-4111-8111-dd00000000d1';
const userA = '22222222-2222-4222-8222-dd00000000d1';
const brandA = '33333333-3333-4333-8333-dd00000000d1';

const NOW = new Date('2026-05-15T12:00:00Z');

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@pd.test', name: 'A' });
    await tx
      .insert(organizations)
      .values({ id: orgA, name: 'Org A', slug: 'pd-org-a', planId });
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Trattoria',
      slug: 'pd-trattoria',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

function buildSpies(): PublishDashboardDeps {
  return {
    list: vi.fn(defaultPublishDashboardDeps.list),
    kpis: vi.fn(defaultPublishDashboardDeps.kpis),
    calendar: vi.fn(defaultPublishDashboardDeps.calendar),
    orgTimezone: vi.fn(defaultPublishDashboardDeps.orgTimezone),
    brandOptions: vi.fn(defaultPublishDashboardDeps.brandOptions),
    campaignOptions: vi.fn(defaultPublishDashboardDeps.campaignOptions),
  };
}

describe('loadPublishDashboardDataWithTx — single-pass contract', () => {
  it("calls calendar exactly once when view='calendar'", async () => {
    const spies = buildSpies();
    const filters = parsePublishFilters({}, { now: NOW }); // defaults to view=calendar
    expect(filters.view).toBe('calendar');

    await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      loadPublishDashboardDataWithTx(tx, {
        orgId: orgA,
        userId: userA,
        filters,
        deps: spies,
      }),
    );

    expect(spies.list).toHaveBeenCalledTimes(1);
    expect(spies.kpis).toHaveBeenCalledTimes(1);
    expect(spies.calendar).toHaveBeenCalledTimes(1);
    expect(spies.orgTimezone).toHaveBeenCalledTimes(1);
    expect(spies.brandOptions).toHaveBeenCalledTimes(1);
    expect(spies.campaignOptions).toHaveBeenCalledTimes(1);
  });

  it("does NOT call calendar when the view tab isn't 'calendar'", async () => {
    const spies = buildSpies();
    const filters = parsePublishFilters(
      new URLSearchParams('view=failed'),
      { now: NOW },
    );
    expect(filters.view).toBe('failed');

    await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      loadPublishDashboardDataWithTx(tx, {
        orgId: orgA,
        userId: userA,
        filters,
        deps: spies,
      }),
    );

    expect(spies.list).toHaveBeenCalledTimes(1);
    expect(spies.kpis).toHaveBeenCalledTimes(1);
    expect(spies.calendar).not.toHaveBeenCalled();
    // The cheap helpers always run — they feed the filter bar
    // and the timezone-aware calendar header regardless of tab.
    expect(spies.orgTimezone).toHaveBeenCalledTimes(1);
    expect(spies.brandOptions).toHaveBeenCalledTimes(1);
    expect(spies.campaignOptions).toHaveBeenCalledTimes(1);
  });

  it('returns the org timezone + locale stitched in', async () => {
    const filters = parsePublishFilters({}, { now: NOW });
    // Org A was seeded with the default 'UTC' timezone / 'en' locale.
    const data = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) =>
      loadPublishDashboardDataWithTx(tx, {
        orgId: orgA,
        userId: userA,
        filters,
      }),
    );
    expect(data.orgTimezone).toBe('UTC');
    expect(data.orgLocale).toBe('en');
    expect(data.brandOptions.some((b) => b.id === brandA)).toBe(true);
  });
});
