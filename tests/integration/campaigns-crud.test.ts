import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  auditEvents,
  brands,
  campaigns,
  organizations,
  plans,
  posts,
  users,
} from '../../lib/db/schema';
import {
  getCampaignDetailWithTx,
  getCampaignKpiCountsWithTx,
  listCampaignsWithTx,
  type CampaignListItem,
} from '../../lib/campaigns/queries';
import {
  canTransitionCampaignStatus,
  type CampaignStatus,
} from '../../lib/campaigns/validate';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Campaigns CRUD + status transitions + post association
 * (Commit 21, B11). Each test seeds its own campaign via direct
 * `runAdmin` inserts (the Server Action layer requires a session;
 * we exercise the data + validation layer directly here).
 *
 * Tenant isolation is checked by reading from org B with
 * `runAs({orgId: orgB, …})` and asserting we don't see org A's
 * campaign — RLS is the gate, this confirms it fires.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-cb00cb00cb00';
const orgA = '11111111-1111-4111-8111-cb00cb00cb00';
const orgB = '11111111-1111-4111-8111-cb00cb00cb01';
const userA = '22222222-2222-4222-8222-cb00cb00cb00';
const userB = '22222222-2222-4222-8222-cb00cb00cb01';
const brandA = '33333333-3333-4333-8333-cb00cb00cb00';
const brandB = '33333333-3333-4333-8333-cb00cb00cb01';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values([
      { id: userA, email: 'a@cc.test', name: 'A' },
      { id: userB, email: 'b@cc.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'cc-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'cc-org-b', planId },
    ]);
    await tx.insert(brands).values([
      { id: brandA, organizationId: orgA, name: 'Brand A', slug: 'cc-brand-a' },
      { id: brandB, organizationId: orgB, name: 'Brand B', slug: 'cc-brand-b' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedCampaign(opts: {
  campaignId: string;
  orgId: string;
  brandId: string | null;
  status?: CampaignStatus;
  name: string;
  ownerId: string;
}): Promise<void> {
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(campaigns).values({
      id: opts.campaignId,
      organizationId: opts.orgId,
      brandId: opts.brandId,
      name: opts.name,
      goal: 'launch',
      status: opts.status ?? 'draft',
      ownerId: opts.ownerId,
      startsAt: new Date('2026-05-01T00:00:00Z'),
      endsAt: new Date('2026-05-31T00:00:00Z'),
    });
  });
}

async function readStatus(campaignId: string): Promise<CampaignStatus | null> {
  const rows = await runAdmin<Array<{ status: CampaignStatus }>>(
    fixture.db,
    (tx) =>
      tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, campaignId)),
  );
  return rows[0]?.status ?? null;
}

// ---------------------------------------------------------------------------
// 1. Create + read
// ---------------------------------------------------------------------------

describe('campaigns CRUD — create + read', () => {
  const id = '44444444-4444-4444-8444-cb00cb00cb01';

  it('seeds a draft campaign and lists/reads it via the queries layer', async () => {
    await seedCampaign({
      campaignId: id,
      orgId: orgA,
      brandId: brandA,
      name: 'Lanzamiento Mayo 2026',
      ownerId: userA,
    });

    const page = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listCampaignsWithTx(tx, {
        orgId: orgA,
        userId: userA,
        filters: {},
        cursor: null,
      }),
    );
    const found = page.campaigns.find((c) => c.id === id) as CampaignListItem | undefined;
    expect(found).toBeDefined();
    expect(found!.name).toBe('Lanzamiento Mayo 2026');
    expect(found!.status).toBe('draft');
    expect(found!.brandName).toBe('Brand A');

    const detail = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      getCampaignDetailWithTx(tx, { orgId: orgA, campaignId: id }),
    );
    expect(detail?.goal).toBe('launch');
    expect(detail?.postCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Tenant isolation
// ---------------------------------------------------------------------------

describe('campaigns CRUD — tenant isolation', () => {
  const id = '44444444-4444-4444-8444-cb00cb00cb02';

  it('org B does NOT see org A campaign via list nor detail', async () => {
    await seedCampaign({
      campaignId: id,
      orgId: orgA,
      brandId: brandA,
      name: 'Solo Org A',
      ownerId: userA,
    });

    const pageB = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      listCampaignsWithTx(tx, {
        orgId: orgB,
        userId: userB,
        filters: {},
        cursor: null,
      }),
    );
    expect(pageB.campaigns.find((c) => c.id === id)).toBeUndefined();

    const detailB = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      getCampaignDetailWithTx(tx, { orgId: orgB, campaignId: id }),
    );
    expect(detailB).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Status transition: draft → active (allowed)
// ---------------------------------------------------------------------------

describe('campaigns CRUD — status transition (allowed)', () => {
  const id = '44444444-4444-4444-8444-cb00cb00cb03';

  it('draft → active flips status and the helper agrees', async () => {
    await seedCampaign({
      campaignId: id,
      orgId: orgA,
      brandId: brandA,
      name: 'Will go active',
      ownerId: userA,
    });
    expect(canTransitionCampaignStatus('draft', 'active')).toBe(true);

    await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) => {
      const locked = await tx
        .select({ status: campaigns.status })
        .from(campaigns)
        .where(eq(campaigns.id, id))
        .for('update')
        .limit(1);
      expect(locked[0]?.status).toBe('draft');
      await tx
        .update(campaigns)
        .set({ status: 'active' })
        .where(eq(campaigns.id, id));
    });

    expect(await readStatus(id)).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// 4. Status transition: active → draft (DISALLOWED)
// ---------------------------------------------------------------------------

describe('campaigns CRUD — status transition (disallowed)', () => {
  const id = '44444444-4444-4444-8444-cb00cb00cb04';

  it('canTransitionCampaignStatus rejects rollback + terminal exits', async () => {
    await seedCampaign({
      campaignId: id,
      orgId: orgA,
      brandId: brandA,
      status: 'active',
      name: 'Active → ??',
      ownerId: userA,
    });
    expect(canTransitionCampaignStatus('active', 'draft')).toBe(false);
    expect(canTransitionCampaignStatus('archived', 'active')).toBe(false);
    expect(canTransitionCampaignStatus('completed', 'active')).toBe(false);
    // The action would refuse — we don't UPDATE here; the DB row
    // remains 'active'.
    expect(await readStatus(id)).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// 5. Associate post → campaign (set + dissociate)
// ---------------------------------------------------------------------------

describe('campaigns CRUD — post association', () => {
  const campaignId = '44444444-4444-4444-8444-cb00cb00cb05';
  const postId = '55555555-5555-4555-8555-cb00cb00cb05';

  it('attaches a post to a campaign and detaches it again', async () => {
    await seedCampaign({
      campaignId,
      orgId: orgA,
      brandId: brandA,
      status: 'active',
      name: 'Has posts',
      ownerId: userA,
    });
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values({
        id: postId,
        organizationId: orgA,
        brandId: brandA,
        authorId: userA,
        status: 'draft',
        text: 'post belongs to campaign',
      });
    });

    // Attach.
    await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) => {
      await tx.update(posts).set({ campaignId }).where(eq(posts.id, postId));
    });
    let detail = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      getCampaignDetailWithTx(tx, { orgId: orgA, campaignId }),
    );
    expect(detail?.postCount).toBe(1);

    // Detach.
    await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) => {
      await tx.update(posts).set({ campaignId: null }).where(eq(posts.id, postId));
    });
    detail = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      getCampaignDetailWithTx(tx, { orgId: orgA, campaignId }),
    );
    expect(detail?.postCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Detail post breakdown — scheduled / published / failed
// ---------------------------------------------------------------------------

describe('campaigns CRUD — detail post breakdown', () => {
  const campaignId = '44444444-4444-4444-8444-cb00cb00cb06';

  it('counts posts by status for KPI panel', async () => {
    await seedCampaign({
      campaignId,
      orgId: orgA,
      brandId: brandA,
      status: 'active',
      name: 'KPIs',
      ownerId: userA,
    });
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(posts).values([
        {
          id: '66666666-6666-4666-8666-cb00cb00cb01',
          organizationId: orgA,
          brandId: brandA,
          authorId: userA,
          status: 'scheduled',
          text: 's',
          campaignId,
        },
        {
          id: '66666666-6666-4666-8666-cb00cb00cb02',
          organizationId: orgA,
          brandId: brandA,
          authorId: userA,
          status: 'published',
          text: 'p',
          campaignId,
        },
        {
          id: '66666666-6666-4666-8666-cb00cb00cb03',
          organizationId: orgA,
          brandId: brandA,
          authorId: userA,
          status: 'failed',
          text: 'f',
          campaignId,
        },
      ]);
    });
    const detail = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      getCampaignDetailWithTx(tx, { orgId: orgA, campaignId }),
    );
    expect(detail?.postCount).toBe(3);
    expect(detail?.scheduledPostCount).toBe(1);
    expect(detail?.publishedPostCount).toBe(1);
    expect(detail?.failedPostCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 7. KPI totals — totalBudgetCents sums non-archived
// ---------------------------------------------------------------------------

describe('campaigns CRUD — KPI totals', () => {
  it('totalBudgetCents sums all non-archived campaigns', async () => {
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(campaigns).values([
        {
          id: '44444444-4444-4444-8444-cb00cb00cb07',
          organizationId: orgA,
          brandId: brandA,
          name: 'Active with budget',
          goal: 'launch',
          status: 'active',
          budgetCents: 50_000,
        },
        {
          id: '44444444-4444-4444-8444-cb00cb00cb08',
          organizationId: orgA,
          brandId: brandA,
          name: 'Archived with budget — should NOT count',
          goal: 'launch',
          status: 'archived',
          budgetCents: 999_999,
        },
      ]);
    });
    const counts = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      getCampaignKpiCountsWithTx(tx, orgA),
    );
    expect(counts.totalBudgetCents).toBeLessThan(999_999);
    expect(counts.totalBudgetCents).toBeGreaterThanOrEqual(50_000);
  });
});

// ---------------------------------------------------------------------------
// 8. audit_events writes shape
// ---------------------------------------------------------------------------

describe('campaigns CRUD — audit events shape', () => {
  it('records actorType=user on a manual insert via audit_events', async () => {
    const id = '44444444-4444-4444-8444-cb00cb00cb09';
    await seedCampaign({
      campaignId: id,
      orgId: orgA,
      brandId: brandA,
      name: 'Audit shape',
      ownerId: userA,
    });
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId: orgA,
        userId: userA,
        actorType: 'user',
        action: 'campaign.created',
        entityType: 'campaign',
        entityId: id,
        after: { name: 'Audit shape', status: 'draft' },
      });
    });
    const rows = await runAdmin<Array<{ action: string; actorType: string }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            action: auditEvents.action,
            actorType: auditEvents.actorType,
          })
          .from(auditEvents)
          .where(eq(auditEvents.entityId, id)),
    );
    expect(rows.some((r) => r.action === 'campaign.created')).toBe(true);
    expect(rows.every((r) => r.actorType === 'user')).toBe(true);
  });
});
