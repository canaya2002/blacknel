import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  listeningMentions,
  listeningTrackedTerms,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  runListeningScanTick,
  type ListeningScanDeps,
} from '../../lib/jobs/listening-scan';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 33 — listening cron behavior + idempotency.
 *
 * The cron calls into `persistMention`, which invokes Phase-7 AI
 * skills via `lib/ai/skills/sentiment` + `intent`. Those skills go
 * through the mock adapter under `BLACKNEL_USE_MOCKS=true` (default
 * in test env), so the test exercises the full pipeline end-to-end
 * without hitting any live API.
 *
 * Coverage:
 *   - Same UTC day: re-running the tick is a no-op (mention set
 *     stable, ON CONFLICT DO NOTHING on the external_unique).
 *   - Paused terms are skipped.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3302c3302c0';
const orgId = '11111111-1111-4111-8111-c3302c3302c0';
const userId = '22222222-2222-4222-8222-c3302c3302c0';
const activeTermId = '88888888-8888-4888-8888-c3302c3302c0';
const pausedTermId = '88888888-8888-4888-8888-c3302c3302c1';

const deps: ListeningScanDeps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) =>
    runAdmin(fixture.db, fn),
};

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values({
      id: userId,
      email: 'a@c3302.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Scan Org',
      slug: 'c3302-scan',
      planId,
    });
    await tx.insert(listeningTrackedTerms).values([
      {
        id: activeTermId,
        organizationId: orgId,
        term: 'active-term',
        termKind: 'handle',
        platforms: ['x', 'instagram'],
        status: 'active',
      },
      {
        id: pausedTermId,
        organizationId: orgId,
        term: 'paused-term',
        termKind: 'handle',
        platforms: ['x'],
        status: 'paused',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runListeningScanTick', () => {
  it('persists mentions for active terms and skips paused ones', async () => {
    const now = new Date('2026-05-17T12:00:00Z');
    const result = await runListeningScanTick({ now, deps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.termsScanned).toBe(1);
    expect(result.data.mentionsCaptured).toBeGreaterThan(0);

    type Row = { id: string; trackedTermId: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          id: listeningMentions.id,
          trackedTermId: listeningMentions.trackedTermId,
        })
        .from(listeningMentions)
        .where(eq(listeningMentions.organizationId, orgId)),
    )) as Row[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.trackedTermId).toBe(activeTermId);
    }
  });

  it('re-running the same UTC day tick is idempotent (no new captures)', async () => {
    const now = new Date('2026-05-17T18:00:00Z');
    const first = await runListeningScanTick({ now, deps });
    expect(first.ok).toBe(true);

    const beforeCount: Array<{ count: number }> = await runAdmin(
      fixture.db,
      (tx) =>
        tx
          .select({ count: listeningMentions.id })
          .from(listeningMentions),
    );
    const before = beforeCount.length;

    const second = await runListeningScanTick({ now, deps });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // Every persist attempt should report skipped (ON CONFLICT)
    // since the externals already exist.
    expect(second.data.mentionsCaptured).toBe(0);

    const afterCount: Array<{ count: number }> = await runAdmin(
      fixture.db,
      (tx) =>
        tx
          .select({ count: listeningMentions.id })
          .from(listeningMentions),
    );
    expect(afterCount.length).toBe(before);
  });
});
