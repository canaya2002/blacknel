import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { competitorsAggregatesSource } from '../../lib/custom-reports/data-sources/competitors-aggregates';
import type { DataSourceContext } from '../../lib/custom-reports/data-sources/index';
import { listeningAggregatesSource } from '../../lib/custom-reports/data-sources/listening-aggregates';
import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import {
  competitorMetricsDaily,
  competitors,
  listeningMentions,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C53 listening + competitors data sources executed against pglite: listening
 * timeseries (mention volume + net sentiment) and the new competitors_aggregates
 * (share-of-voice + competitor volume), all org-scoped via the RLS tx.
 */

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-c53d00000001';
const orgA = '11111111-1111-4111-8111-c53d00000001';
const userA = '22222222-2222-4222-8222-c53d00000001';
const comp = '77777777-7777-4777-8777-c53d00000001';
const RANGE_START = new Date('2026-05-01T00:00:00Z');
const RANGE_END = new Date('2026-05-31T00:00:00Z');

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'enterprise', name: 'Enterprise', priceCents: 109900 });
    await tx.insert(users).values({ id: userA, email: 'a@c53d.test', name: 'A' });
    await tx.insert(organizations).values({ id: orgA, name: 'Org A', slug: 'c53d-org-a', planId });
    // 2 positive + 1 negative mention on 2026-05-10.
    await tx.insert(listeningMentions).values([
      { organizationId: orgA, platform: 'facebook', externalId: 'm1', authorHandle: 'a', body: 'good', sentiment: 'positive', capturedAt: new Date('2026-05-10T08:00:00Z') },
      { organizationId: orgA, platform: 'facebook', externalId: 'm2', authorHandle: 'b', body: 'great', sentiment: 'positive', capturedAt: new Date('2026-05-10T09:00:00Z') },
      { organizationId: orgA, platform: 'facebook', externalId: 'm3', authorHandle: 'c', body: 'bad', sentiment: 'negative', capturedAt: new Date('2026-05-10T10:00:00Z') },
    ]);
    await tx.insert(competitors).values({ id: comp, organizationId: orgA, name: 'Rival', handles: {}, platforms: ['x'], status: 'active' });
    await tx.insert(competitorMetricsDaily).values([
      { organizationId: orgA, competitorId: comp, platform: 'x', day: '2026-05-10', postsCount: 10, engagementTotal: 500, sentimentScore: '0.20', shareOfVoice: '0.600' },
      { organizationId: orgA, competitorId: comp, platform: 'x', day: '2026-05-11', postsCount: 20, engagementTotal: 900, sentimentScore: '0.10', shareOfVoice: '0.400' },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

function ctx(tx: AnyPgTx): DataSourceContext {
  return { tx, orgId: orgA, userId: userA, rangeStart: RANGE_START, rangeEnd: RANGE_END, brandId: null };
}

describe('listening_aggregates timeseries', () => {
  it('mention_volume = daily count; net_sentiment = positives − negatives', async () => {
    const { vol, net } = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) => ({
      vol: await listeningAggregatesSource.loadTimeseries!('mention_volume', ctx(tx)),
      net: await listeningAggregatesSource.loadTimeseries!('net_sentiment', ctx(tx)),
    }));
    expect(vol).toEqual([{ t: '2026-05-10', v: 3 }]);
    expect(net).toEqual([{ t: '2026-05-10', v: 1 }]); // 2 pos − 1 neg
  });
});

describe('competitors_aggregates', () => {
  it('scalars: total posts + avg share-of-voice', async () => {
    const { posts, sov } = await runAs(fixture.db, { orgId: orgA, userId: userA }, async (tx) => ({
      posts: await competitorsAggregatesSource.loadScalar!('total_competitor_posts', ctx(tx)),
      sov: await competitorsAggregatesSource.loadScalar!('avg_share_of_voice', ctx(tx)),
    }));
    expect(posts.value).toBe(30); // 10 + 20
    expect(sov.value).toBe(0.5); // (0.6 + 0.4) / 2
  });

  it('timeseries: share_of_voice by day', async () => {
    const ts = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      competitorsAggregatesSource.loadTimeseries!('share_of_voice', ctx(tx)),
    );
    expect(ts).toEqual([
      { t: '2026-05-10', v: 0.6 },
      { t: '2026-05-11', v: 0.4 },
    ]);
  });
});
