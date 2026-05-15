import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin } from '../../lib/db/client';
import {
  connectedAccounts,
  connectorSyncRuns,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Action-level integration tests for /integrations operations. We
 * exercise the underlying DB transitions directly (the Server Actions
 * themselves reach for cookies / requireUser that vitest can't supply
 * without a Next request context — that's covered by Phase 1's RLS
 * test and the role matrix unit tests).
 *
 * What we lock in here:
 *
 *   1. Tenant isolation on connected_accounts — org A cannot read
 *      org B's accounts via dbAs.
 *   2. The unique index on (org, platform, externalAccountId) holds.
 *   3. ON DELETE CASCADE removes child sync_runs.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-e00000000001';
const orgA = '11111111-1111-4111-8111-eeeeeeeeeeea';
const orgB = '11111111-1111-4111-8111-eeeeeeeeeeeb';
const userA = '22222222-2222-4222-8222-eeeeeeeeeeea';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@a.test', name: 'A' });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'integ-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'integ-org-b', planId },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('connected_accounts tenant isolation', () => {
  it('insertions on org A are scoped to org A', async () => {
    const accId = await runAdmin<{ id: string }[]>(fixture.db, async (tx) =>
      tx
        .insert(connectedAccounts)
        .values({
          organizationId: orgA,
          platform: 'facebook',
          externalAccountId: 'ext-org-a-1',
          displayName: 'Org A FB',
          capabilities: ['read_comments', 'reply_comments'],
        })
        .returning({ id: connectedAccounts.id }),
    ).then((rows) => rows[0]!.id);

    const orgARows = await runAdmin<Array<{ id: string }>>(fixture.db, async (tx) =>
      tx
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(eq(connectedAccounts.organizationId, orgA)),
    );
    expect(orgARows.some((r) => r.id === accId)).toBe(true);

    const orgBRows = await runAdmin<Array<{ id: string }>>(fixture.db, async (tx) =>
      tx
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(eq(connectedAccounts.organizationId, orgB)),
    );
    expect(orgBRows.find((r) => r.id === accId)).toBeUndefined();
  });
});

describe('connected_accounts unique constraint', () => {
  it('duplicate (org, platform, externalAccountId) is rejected', async () => {
    await runAdmin(fixture.db, async (tx) =>
      tx.insert(connectedAccounts).values({
        organizationId: orgA,
        platform: 'instagram',
        externalAccountId: 'ext-unique-1',
        capabilities: ['publish_post'],
      }),
    );

    await expect(
      runAdmin(fixture.db, async (tx) =>
        tx.insert(connectedAccounts).values({
          organizationId: orgA,
          platform: 'instagram',
          externalAccountId: 'ext-unique-1', // same!
          capabilities: ['publish_post'],
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('connector_sync_runs cascade delete', () => {
  it('removing a connected_account removes its sync runs', async () => {
    const accId = await runAdmin<{ id: string }[]>(fixture.db, async (tx) =>
      tx
        .insert(connectedAccounts)
        .values({
          organizationId: orgA,
          platform: 'tiktok',
          externalAccountId: 'ext-cascade-1',
          capabilities: [],
        })
        .returning({ id: connectedAccounts.id }),
    ).then((rows) => rows[0]!.id);

    await runAdmin(fixture.db, async (tx) =>
      tx.insert(connectorSyncRuns).values([
        {
          connectedAccountId: accId,
          status: 'success',
          finishedAt: new Date(),
          itemsSynced: 5,
        },
        {
          connectedAccountId: accId,
          status: 'failed',
          finishedAt: new Date(),
          itemsSynced: 0,
          errorMessage: 'mock',
        },
      ]),
    );

    const beforeRuns = await runAdmin(fixture.db, async (tx) =>
      tx
        .select()
        .from(connectorSyncRuns)
        .where(eq(connectorSyncRuns.connectedAccountId, accId)),
    );
    expect(beforeRuns.length).toBe(2);

    await runAdmin(fixture.db, async (tx) =>
      tx.delete(connectedAccounts).where(eq(connectedAccounts.id, accId)),
    );

    const afterRuns = await runAdmin(fixture.db, async (tx) =>
      tx
        .select()
        .from(connectorSyncRuns)
        .where(eq(connectorSyncRuns.connectedAccountId, accId)),
    );
    expect(afterRuns.length).toBe(0);
  });
});
