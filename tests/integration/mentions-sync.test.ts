import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NormalizedMention } from '../../lib/connectors/base/normalized';
import type { ConnectorAccount } from '../../lib/connectors/base/types';
import { runMentionsSync } from '../../lib/connectors/mentions-sync';
import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import { listMentionsWithTx } from '../../lib/listening/queries';
import {
  connectedAccounts,
  listeningMentions,
  organizations,
  plans,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C53 account-based mentions sync. pglite + RLS; injected mock fetch + classify
 * (no network, no AI). Covers: capture under connection ref + null tracked term,
 * sentiment applied, idempotent skip-existing (no re-classify), tenant isolation.
 */

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-c53000000001';
const orgA = '11111111-1111-4111-8111-c53a00000001';
const orgB = '11111111-1111-4111-8111-c53b00000001';
const accA = '33333333-3333-4333-8333-c53a00000001';
const accB = '33333333-3333-4333-8333-c53b00000001';

let classifyCalls = 0;

// Two deterministic mentions per account, distinct external ids per account.
const fetchMentions = async (account: ConnectorAccount): Promise<NormalizedMention[]> =>
  [0, 1].map((i) => ({
    platform: account.platform,
    externalId: `m-${account.id}-${i}`,
    author: { platform: account.platform, externalId: `u${i}`, displayName: `User ${i}`, handle: `user${i}` },
    body: `mention ${i}`,
    postedAt: new Date('2026-05-20T00:00:00Z'),
    url: `https://x/${i}`,
    sentiment: 0.5,
  }));

const classify = async (): Promise<{ sentiment: 'positive' | 'neutral' | 'negative'; confidence: number }> => {
  classifyCalls += 1;
  return { sentiment: 'positive', confidence: 0.88 };
};

const deps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
  fetchMentions,
  classify,
};

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c53-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c53-org-b', planId },
    ]);
    await tx.insert(connectedAccounts).values([
      { id: accA, organizationId: orgA, platform: 'facebook', externalAccountId: 'pgA', status: 'connected' },
      { id: accB, organizationId: orgB, platform: 'facebook', externalAccountId: 'pgB', status: 'connected' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runMentionsSync', () => {
  it('captures mentions with connection ref + sentiment, null tracked term', async () => {
    const report = await runMentionsSync(deps);
    expect(report.accounts).toBe(2);
    expect(report.inserted).toBe(4); // 2 accounts × 2 mentions
    expect(report.failed).toBe(0);
    expect(classifyCalls).toBe(4);

    const rows = await runAdmin<
      Array<{ connectedAccountId: string | null; trackedTermId: string | null; sentiment: string; sentimentScore: string }>
    >(fixture.db, (tx) =>
      tx
        .select({
          connectedAccountId: listeningMentions.connectedAccountId,
          trackedTermId: listeningMentions.trackedTermId,
          sentiment: listeningMentions.sentiment,
          sentimentScore: listeningMentions.sentimentScore,
        })
        .from(listeningMentions),
    );
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.connectedAccountId).not.toBeNull();
      expect(r.trackedTermId).toBeNull();
      expect(r.sentiment).toBe('positive');
      expect(Number(r.sentimentScore)).toBeCloseTo(0.88, 2);
    }
  });

  it('is idempotent — re-run skips existing without re-classifying', async () => {
    classifyCalls = 0;
    const report = await runMentionsSync(deps);
    expect(report.inserted).toBe(0);
    expect(report.skipped).toBe(4);
    expect(classifyCalls).toBe(0); // no AI on already-captured mentions
  });

  it('tenant isolation: org A sees only its own mentions under RLS', async () => {
    const aRows = await runAsOrg<Array<{ id: string }>>(fixture.db, orgA, (tx) =>
      tx.select({ id: listeningMentions.id }).from(listeningMentions),
    );
    const bRows = await runAsOrg<Array<{ id: string; acc: string | null }>>(fixture.db, orgB, (tx) =>
      tx.select({ id: listeningMentions.id, acc: listeningMentions.connectedAccountId }).from(listeningMentions),
    );
    expect(aRows).toHaveLength(2);
    expect(bRows).toHaveLength(2);
    expect(bRows.every((r) => r.acc === accB)).toBe(true);
  });

  it('account-discovered mentions surface in listMentions (left join, null term)', async () => {
    const rows = await runAsOrg(fixture.db, orgA, (tx) => listMentionsWithTx(tx, orgA, {}));
    // The fix: NULL tracked_term_id mentions must NOT be dropped by the join.
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.trackedTermId).toBeNull();
      expect(r.term).toBeNull();
    }
  });
});
