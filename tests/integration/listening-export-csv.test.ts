import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  listeningMentions,
  listeningTrackedTerms,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  listMentionsWithTx,
  type MentionRow,
} from '../../lib/listening/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 33 — Ajuste A CSV export.
 *
 * The Server Action `exportListeningMentionsCsvAction` is a thin
 * wrapper around `listMentions` + the same `csvEscape` helper used
 * across phase-8 exports. We verify the underlying data shape +
 * header structure directly to avoid booting a session.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3303c3303c0';
const orgId = '11111111-1111-4111-8111-c3303c3303c0';
const userId = '22222222-2222-4222-8222-c3303c3303c0';
const termId = '88888888-8888-4888-8888-c3303c3303c0';

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
      email: 'a@c3303.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Export Org',
      slug: 'c3303-export',
      planId,
    });
    await tx.insert(listeningTrackedTerms).values({
      id: termId,
      organizationId: orgId,
      term: 'export-brand',
      termKind: 'keyword',
      platforms: ['x'],
      status: 'active',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

const asAdminTx = <T>(fn: (tx: AnyPgTx) => Promise<T>): Promise<T> =>
  runAdmin(fixture.db, fn);

describe('Listening CSV export — data shape', () => {
  it('empty result → header-only CSV', async () => {
    const mentions: MentionRow[] = await asAdminTx((tx) =>
      listMentionsWithTx(tx, orgId, { status: 'all' }),
    );
    expect(mentions).toHaveLength(0);
    const csv = toCsv(mentions);
    expect(csv.split('\n')).toHaveLength(1);
    expect(csv).toContain('captured_at');
    expect(csv).toContain('sentiment_score');
    expect(csv).toContain('is_lead');
  });

  it('mentions with comma/quote/lead flag get escaped + rendered correctly', async () => {
    await asAdminTx(async (tx) => {
      await tx.insert(listeningMentions).values([
        {
          organizationId: orgId,
          trackedTermId: termId,
          platform: 'x',
          externalId: 'tweet-csv-1',
          authorHandle: 'comma_author',
          authorDisplayName: 'Comma, Name',
          body: 'has, "quotes", and commas',
          sentiment: 'positive',
          sentimentScore: '0.92',
          isLead: true,
          url: 'https://example.com/1',
        },
        {
          organizationId: orgId,
          trackedTermId: termId,
          platform: 'x',
          externalId: 'tweet-csv-2',
          authorHandle: 'plain_author',
          body: 'plain mention',
          sentiment: 'neutral',
          sentimentScore: '0.50',
          isLead: false,
        },
      ]);
    });
    const mentions: MentionRow[] = await asAdminTx((tx) =>
      listMentionsWithTx(tx, orgId, { status: 'all' }),
    );
    expect(mentions).toHaveLength(2);
    const csv = toCsv(mentions);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    // The body column carries commas + double-quotes; verify the
    // escape sequence is exactly what csvEscape produces.
    const escapedRow = lines.find((line) =>
      line.includes('comma_author'),
    );
    expect(escapedRow).toBeDefined();
    expect(escapedRow!).toContain(
      '"has, ""quotes"", and commas"',
    );
    // The lead flag renders as `true` / `false`.
    expect(csv).toContain('true');
    expect(csv).toContain('false');
  });

  it('status filter narrows the rows', async () => {
    await asAdminTx(async (tx) => {
      await tx.insert(listeningMentions).values({
        organizationId: orgId,
        trackedTermId: termId,
        platform: 'reddit',
        externalId: 'reddit-csv-1',
        authorHandle: 'u_archived',
        body: 'archived mention',
        sentiment: 'neutral',
        sentimentScore: '0.50',
        status: 'archived',
      });
    });
    const all: MentionRow[] = await asAdminTx((tx) =>
      listMentionsWithTx(tx, orgId, { status: 'all' }),
    );
    const archived: MentionRow[] = await asAdminTx((tx) =>
      listMentionsWithTx(tx, orgId, { status: 'archived' }),
    );
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(archived.length).toBeGreaterThanOrEqual(1);
    for (const m of archived) {
      expect(m.status).toBe('archived');
    }
  });
});

function toCsv(rows: MentionRow[]): string {
  const header = [
    'captured_at',
    'platform',
    'author_handle',
    'body',
    'sentiment',
    'sentiment_score',
    'is_lead',
    'status',
    'url',
    'assigned_thread_id',
  ];
  const dataRows = rows.map((m) => [
    m.capturedAt.toISOString(),
    m.platform,
    m.authorHandle,
    m.body.slice(0, 500),
    m.sentiment,
    m.sentimentScore.toFixed(2),
    m.isLead ? 'true' : 'false',
    m.status,
    m.url ?? '',
    m.assignedThreadId ?? '',
  ]);
  return [header, ...dataRows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
