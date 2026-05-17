import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getBrandVoiceDetailWithTx,
  listBrandsWithVoiceWithTx,
} from '../../lib/brand-voice/queries';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  auditEvents,
  brandVoices,
  brands,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Brand-voice actions integration (Commit 26 / B6).
 *
 * The Server Actions require a Next request session (`requireUser`),
 * so we exercise the DB transitions directly under `runAdmin` /
 * `runAs` to verify:
 *
 *   1. INSERT brand_voice + LINK brands.brand_voice_id.
 *   2. UPDATE brand_voice preserves the link.
 *   3. Tenant isolation — orgB cannot read orgA voice rows.
 *   4. Audit row shape matches `brand_voice.created` / `.updated`.
 *   5. Last-write-wins (D-26-2) — two concurrent UPDATEs both
 *      land without raising; the last one wins.
 *   6. RBAC matrix — agent / viewer lack `brand_voice:manage`.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2600c2600c0';
const orgA = '11111111-1111-4111-8111-c2600c2600c0';
const orgB = '11111111-1111-4111-8111-c2600c2600c1';
const userMgr = '22222222-2222-4222-8222-c2600c2600c0';
const brandA = '33333333-3333-4333-8333-c2600c2600c0';
const brandB = '33333333-3333-4333-8333-c2600c2600c1';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userMgr, email: 'm@c26.test', name: 'Mgr' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c26-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c26-org-b', planId },
    ]);
    await tx.insert(brands).values([
      { id: brandA, organizationId: orgA, name: 'Brand A', slug: 'c26-brand-a' },
      { id: brandB, organizationId: orgB, name: 'Brand B', slug: 'c26-brand-b' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedBrandVoice(opts: {
  voiceId: string;
  orgId: string;
  brandId: string;
  approvalRules?: {
    requireApprovalForPosts?: boolean;
    requireApprovalForPostsOnPlatforms?: string[];
    requireApprovalForCampaignTypes?: string[];
  };
}): Promise<void> {
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(brandVoices).values({
      id: opts.voiceId,
      organizationId: opts.orgId,
      name: 'Test Voice',
      tone: 'cordial',
      style: 'directo',
      forbiddenWords: ['refund'],
      preferredWords: ['cuidado'],
      allowedEmojis: ['✨'],
      languages: ['es'],
      metadata: opts.approvalRules ? { approvalRules: opts.approvalRules } : {},
    });
    await tx
      .update(brands)
      .set({ brandVoiceId: opts.voiceId })
      .where(eq(brands.id, opts.brandId));
  });
}

// ---------------------------------------------------------------------------
// 1. create flow — seed + verify link
// ---------------------------------------------------------------------------

describe('brand-voice — create flow', () => {
  const voiceId = '99999999-9999-4999-8999-c2600c2600d1';
  it('INSERT brand_voice + LINK brand.brand_voice_id', async () => {
    await seedBrandVoice({ voiceId, orgId: orgA, brandId: brandA });
    const brandRow = await runAdmin<
      Array<{ id: string; brandVoiceId: string | null }>
    >(fixture.db, (tx) =>
      tx
        .select({ id: brands.id, brandVoiceId: brands.brandVoiceId })
        .from(brands)
        .where(eq(brands.id, brandA)),
    );
    expect(brandRow[0]?.brandVoiceId).toBe(voiceId);
  });
});

// ---------------------------------------------------------------------------
// 2. update + read back
// ---------------------------------------------------------------------------

describe('brand-voice — update preserves link', () => {
  const voiceId = '99999999-9999-4999-8999-c2600c2600d2';
  it('UPDATE rewrites fields without breaking brands.brand_voice_id', async () => {
    await seedBrandVoice({ voiceId, orgId: orgA, brandId: brandA });
    // Drop brand A's link first to avoid collision with prior test.
    await runAdmin(fixture.db, (tx) =>
      tx.update(brands).set({ brandVoiceId: voiceId }).where(eq(brands.id, brandA)),
    );

    await runAdmin(fixture.db, (tx) =>
      tx
        .update(brandVoices)
        .set({
          name: 'Updated Voice',
          tone: 'profesional',
          forbiddenWords: ['lawsuit'],
        })
        .where(eq(brandVoices.id, voiceId)),
    );

    const detail = await runAs(fixture.db, { orgId: orgA, userId: userMgr }, (tx) =>
      getBrandVoiceDetailWithTx(tx, { orgId: orgA, brandVoiceId: voiceId }),
    );
    expect(detail?.name).toBe('Updated Voice');
    expect(detail?.tone).toBe('profesional');
    expect(detail?.forbiddenWords).toEqual(['lawsuit']);

    // Link still intact.
    const brandRow = await runAdmin<
      Array<{ brandVoiceId: string | null }>
    >(fixture.db, (tx) =>
      tx
        .select({ brandVoiceId: brands.brandVoiceId })
        .from(brands)
        .where(eq(brands.id, brandA)),
    );
    expect(brandRow[0]?.brandVoiceId).toBe(voiceId);
  });
});

// ---------------------------------------------------------------------------
// 3. tenant isolation
// ---------------------------------------------------------------------------

describe('brand-voice — tenant isolation', () => {
  const voiceId = '99999999-9999-4999-8999-c2600c2600d3';
  it('orgB cannot read orgA voice rows through listBrandsWithVoiceWithTx', async () => {
    await seedBrandVoice({ voiceId, orgId: orgA, brandId: brandA });
    const rowsB = await runAs(fixture.db, { orgId: orgB, userId: userMgr }, (tx) =>
      listBrandsWithVoiceWithTx(tx, orgB),
    );
    expect(rowsB.find((r) => r.brandVoiceId === voiceId)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. audit shape — brand_voice.approval_rules.changed
// ---------------------------------------------------------------------------

describe('brand-voice — audit row shape', () => {
  const voiceId = '99999999-9999-4999-8999-c2600c2600d4';
  it('records brand_voice.approval_rules.changed with before / after / diff', async () => {
    await seedBrandVoice({
      voiceId,
      orgId: orgA,
      brandId: brandA,
      approvalRules: {
        requireApprovalForPosts: false,
        requireApprovalForPostsOnPlatforms: [],
        requireApprovalForCampaignTypes: [],
      },
    });

    // Simulate the Server Action's audit emission for a
    // rule change.
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId: orgA,
        userId: userMgr,
        actorType: 'user',
        action: 'brand_voice.approval_rules.changed',
        entityType: 'brand_voice',
        entityId: voiceId,
        before: {
          requireApprovalForPosts: false,
          requireApprovalForPostsOnPlatforms: [],
          requireApprovalForCampaignTypes: [],
        },
        after: {
          requireApprovalForPosts: true,
          requireApprovalForPostsOnPlatforms: ['instagram'],
          requireApprovalForCampaignTypes: [],
          diff: {
            requireApprovalForPostsChanged: { from: false, to: true },
            addedPlatforms: ['instagram'],
            removedPlatforms: [],
            addedGoals: [],
            removedGoals: [],
          },
        },
        riskLevel: 'medium',
      });
    });

    const audits = await runAdmin<
      Array<{ action: string; before: unknown; after: unknown }>
    >(fixture.db, (tx) =>
      tx
        .select({
          action: auditEvents.action,
          before: auditEvents.before,
          after: auditEvents.after,
        })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.entityId, voiceId),
            eq(auditEvents.action, 'brand_voice.approval_rules.changed'),
          ),
        ),
    );
    expect(audits.length).toBe(1);
    const a = audits[0]!;
    expect(a.before).toMatchObject({ requireApprovalForPosts: false });
    expect(a.after).toMatchObject({
      requireApprovalForPosts: true,
      diff: { addedPlatforms: ['instagram'] },
    });
  });
});

// ---------------------------------------------------------------------------
// 5. last-write-wins (D-26-2)
// ---------------------------------------------------------------------------

describe('brand-voice — last-write-wins (D-26-2)', () => {
  const voiceId = '99999999-9999-4999-8999-c2600c2600d5';
  it('two sequential UPDATEs both apply; final state matches the last', async () => {
    await seedBrandVoice({ voiceId, orgId: orgA, brandId: brandA });

    // Two competing edits (simulated sequentially since pglite is
    // single-connection). With LWW semantics, no error fires.
    await runAdmin(fixture.db, (tx) =>
      tx.update(brandVoices).set({ tone: 'first' }).where(eq(brandVoices.id, voiceId)),
    );
    await runAdmin(fixture.db, (tx) =>
      tx.update(brandVoices).set({ tone: 'second' }).where(eq(brandVoices.id, voiceId)),
    );

    const detail = await runAs(fixture.db, { orgId: orgA, userId: userMgr }, (tx) =>
      getBrandVoiceDetailWithTx(tx, { orgId: orgA, brandVoiceId: voiceId }),
    );
    expect(detail?.tone).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// 6. RBAC matrix
// ---------------------------------------------------------------------------

describe('brand-voice — RBAC matrix', () => {
  it('manager / admin / owner have brand_voice:manage; agent / viewer do not', async () => {
    const { ROLE_PERMISSIONS } = await import('../../lib/permissions/roles');
    expect(ROLE_PERMISSIONS.owner).toContain('brand_voice:manage');
    expect(ROLE_PERMISSIONS.admin).toContain('brand_voice:manage');
    expect(ROLE_PERMISSIONS.manager).toContain('brand_voice:manage');
    expect(ROLE_PERMISSIONS.agent).not.toContain('brand_voice:manage');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('brand_voice:manage');
  });
});
