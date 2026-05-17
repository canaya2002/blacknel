import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  brands,
  listeningMentions,
  listeningTrackedTerms,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 33 — tracked term + mention CRUD + tenant
 * isolation.
 *
 * Drives the DB directly through `runAdmin`/`runAs` since the Server
 * Actions require `requireUser`. Coverage: insert/list/archive of
 * tracked_terms, unique constraint, RLS isolation, mention insert
 * with FK to a tracked_term.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3300c3300c0';
const orgA = '11111111-1111-4111-8111-c3300c3300c0';
const orgB = '11111111-1111-4111-8111-c3300c3300c1';
const userA = '22222222-2222-4222-8222-c3300c3300c0';
const userB = '22222222-2222-4222-8222-c3300c3300c1';
const brandA = '33333333-3333-4333-8333-c3300c3300c0';
const termA = '88888888-8888-4888-8888-c3300c3300c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values([
      { id: userA, email: 'a@c33.test', name: 'A' },
      { id: userB, email: 'b@c33.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c33-a', planId },
      { id: orgB, name: 'Org B', slug: 'c33-b', planId },
    ]);
    await tx.insert(brands).values({
      id: brandA,
      organizationId: orgA,
      name: 'Brand A',
      slug: 'c33-brand-a',
    });
    await tx.insert(listeningTrackedTerms).values({
      id: termA,
      organizationId: orgA,
      brandId: brandA,
      term: 'my-brand',
      termKind: 'keyword',
      platforms: ['x', 'instagram'],
      status: 'active',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('listening_tracked_terms', () => {
  it('list returns the org A row', async () => {
    type Row = { id: string; term: string };
    const rows = (await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        tx
          .select({
            id: listeningTrackedTerms.id,
            term: listeningTrackedTerms.term,
          })
          .from(listeningTrackedTerms)
          .where(eq(listeningTrackedTerms.organizationId, orgA)),
    )) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.term).toBe('my-brand');
  });

  it('platforms CHECK rejects empty array', async () => {
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(listeningTrackedTerms).values({
          organizationId: orgA,
          term: 'empty',
          termKind: 'keyword',
          platforms: [],
        }),
      ),
    ).rejects.toThrow();
  });

  it('unique (org, brand, term, kind) blocks duplicate insert', async () => {
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(listeningTrackedTerms).values({
          organizationId: orgA,
          brandId: brandA,
          term: 'my-brand',
          termKind: 'keyword',
          platforms: ['x'],
        }),
      ),
    ).rejects.toThrow();
  });

  it('archive sets status + archived_at', async () => {
    const now = new Date();
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        tx
          .update(listeningTrackedTerms)
          .set({ status: 'archived', archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(listeningTrackedTerms.organizationId, orgA),
              eq(listeningTrackedTerms.id, termA),
            ),
          ),
    );
    type Row = { status: string; archivedAt: Date | null };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          status: listeningTrackedTerms.status,
          archivedAt: listeningTrackedTerms.archivedAt,
        })
        .from(listeningTrackedTerms)
        .where(eq(listeningTrackedTerms.id, termA)),
    )) as Row[];
    expect(rows[0]!.status).toBe('archived');
    expect(rows[0]!.archivedAt).not.toBeNull();
  });

  it('tenant isolation: org B sees no rows', async () => {
    type Row = { id: string };
    const rows = (await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) => tx.select({ id: listeningTrackedTerms.id }).from(listeningTrackedTerms),
    )) as Row[];
    expect(rows).toHaveLength(0);
  });
});

describe('listening_mentions FK + uniqueness', () => {
  it('insert + external_unique blocks duplicate (org, platform, external_id)', async () => {
    await runAdmin(fixture.db, (tx) =>
      tx.insert(listeningMentions).values({
        organizationId: orgA,
        trackedTermId: termA,
        platform: 'x',
        externalId: 'tweet-1',
        authorHandle: 'someone',
        body: 'first mention',
      }),
    );
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(listeningMentions).values({
          organizationId: orgA,
          trackedTermId: termA,
          platform: 'x',
          externalId: 'tweet-1',
          authorHandle: 'someone',
          body: 'second attempt',
        }),
      ),
    ).rejects.toThrow();
  });
});
