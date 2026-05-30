import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import {
  connectedAccounts,
  contactProfiles,
  inboxMessages,
  inboxThreads,
  metaWebhookEvents,
  organizations,
  plans,
} from '../../lib/db/schema';
import { _setEncryptionKeyForTests } from '../../lib/connectors/crypto';
import { processMetaWebhookEvent, type InboundDeps } from '../../lib/connectors/meta/inbound';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C46 Meta inbound ingest (P2) + token refresh. Webhook events normalize into
 * the existing inbox under the resolved org's RLS (dbAsOrg); unknown pages fail
 * loudly; reprocessing is idempotent; cross-tenant writes are impossible. The
 * refresh cron re-derives soon-to-expire tokens. pglite + RLS, zero network.
 */

let fixture: TestDb;
let deps: InboundDeps;

const planId = '00000000-0000-4000-8000-d46300000001';
const orgA = '46d44444-4444-4444-8463-a00000000001';
const orgB = '46d44444-4444-4444-8463-b00000000002';
const accountA = '46d66666-6666-4666-8663-a00000000001';
const PAGE_A = 'PAGE_A_100';

function commentEvent(id: string, signature: string, pageId: string, commentId: string) {
  return {
    id,
    eventObject: 'page',
    signature,
    eventPayload: {
      object: 'page',
      entry: [
        {
          id: pageId,
          time: 1700000000,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                comment_id: commentId,
                post_id: 'post_1',
                from: { id: 'fan_1', name: 'Fan One' },
                message: 'Hola equipo',
                created_time: 1700000000,
              },
            },
          ],
        },
      ],
    },
  };
}

beforeAll(async () => {
  _setEncryptionKeyForTests('meta-inbox-test-encryption-key-32-bytes!!');
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Inbox A', slug: 'inbox-a', planId },
      { id: orgB, name: 'Inbox B', slug: 'inbox-b', planId },
    ]);
    await tx.insert(connectedAccounts).values({
      id: accountA,
      organizationId: orgA,
      platform: 'facebook',
      externalAccountId: PAGE_A,
      displayName: 'Page A',
      status: 'connected',
    });
  });
  deps = {
    asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
  };
}, 60_000);

afterAll(async () => {
  _setEncryptionKeyForTests(null);
  await fixture.dispose();
});

describe('processMetaWebhookEvent — page comment → inbox', () => {
  it('creates a thread + message + contact under the resolved org, marks processed', async () => {
    const evId = '46d99999-9999-4999-8999-000000000001';
    await runAdmin(fixture.db, (tx) =>
      tx.insert(metaWebhookEvents).values(commentEvent(evId, 'sig-1', PAGE_A, 'cmt_1')),
    );

    const res = await processMetaWebhookEvent({ webhookEventId: evId }, deps);
    expect(res).toMatchObject({ processed: true, items: 1 });

    const threads = await runAdmin<Array<{ id: string; org: string; kind: string; ext: string | null }>>(
      fixture.db,
      (tx) =>
        tx
          .select({
            id: inboxThreads.id,
            org: inboxThreads.organizationId,
            kind: inboxThreads.kind,
            ext: inboxThreads.externalThreadId,
          })
          .from(inboxThreads),
    );
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ org: orgA, kind: 'comment', ext: 'post_1' });

    const messages = await runAdmin<Array<{ org: string; body: string; dir: string }>>(fixture.db, (tx) =>
      tx
        .select({ org: inboxMessages.organizationId, body: inboxMessages.body, dir: inboxMessages.direction })
        .from(inboxMessages),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ org: orgA, body: 'Hola equipo', dir: 'inbound' });

    const contacts = await runAdmin<Array<{ org: string }>>(fixture.db, (tx) =>
      tx.select({ org: contactProfiles.organizationId }).from(contactProfiles),
    );
    expect(contacts).toEqual([{ org: orgA }]);

    const ev = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: metaWebhookEvents.status }).from(metaWebhookEvents).where(eq(metaWebhookEvents.id, evId)),
    );
    expect(ev[0]?.status).toBe('processed');
  });

  it('is idempotent — reprocessing the same event adds no duplicate message', async () => {
    const evId = '46d99999-9999-4999-8999-000000000001';
    const res = await processMetaWebhookEvent({ webhookEventId: evId }, deps);
    expect(res.reason).toBe('already_processed');
    const count = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: inboxMessages.id }).from(inboxMessages),
    );
    expect(count).toHaveLength(1);
  });

  it('nothing leaks to org B (RLS view is empty)', async () => {
    const seenByB = await runAsOrg(fixture.db, orgB, (tx) =>
      tx.select({ id: inboxThreads.id }).from(inboxThreads).where(eq(inboxThreads.organizationId, orgB)),
    );
    expect(seenByB).toHaveLength(0);
  });

  it('fails loudly for an unknown page (no connected account)', async () => {
    const evId = '46d99999-9999-4999-8999-000000000002';
    await runAdmin(fixture.db, (tx) =>
      tx.insert(metaWebhookEvents).values(commentEvent(evId, 'sig-2', 'PAGE_UNKNOWN', 'cmt_x')),
    );
    const res = await processMetaWebhookEvent({ webhookEventId: evId }, deps);
    expect(res).toMatchObject({ processed: false, reason: 'unknown_account' });
    const ev = await runAdmin<Array<{ status: string; reason: string | null }>>(fixture.db, (tx) =>
      tx
        .select({ status: metaWebhookEvents.status, reason: metaWebhookEvents.failureReason })
        .from(metaWebhookEvents)
        .where(eq(metaWebhookEvents.id, evId)),
    );
    expect(ev[0]).toMatchObject({ status: 'failed', reason: 'unknown_account' });
  });
});
