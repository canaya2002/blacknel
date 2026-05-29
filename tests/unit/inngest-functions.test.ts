import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runAdmin, runAs, runAsOrg, type AnyPgTx } from '../../lib/db/client';
import { emailLog, mediaAssets, organizations, plans } from '../../lib/db/schema';
import {
  _resetEmailDbDepsForTests,
  _setEmailDbDepsForTests,
  _setResendSenderForTests,
} from '../../lib/emails/client';
import { _resetFlagReaderForTests, _setFlagReaderForTests } from '../../lib/flags';
import { _setInngestEmitForTests } from '../../lib/inngest/client';
import { runCleanupPendingUploads } from '../../lib/inngest/functions/cleanup-pending-uploads';
import { functions } from '../../lib/inngest/functions/index';
import {
  runProcessMedia,
  _resetOrgTxForTests,
  _setOrgTxForTests,
} from '../../lib/inngest/functions/process-media';
import { runSendEmail } from '../../lib/inngest/functions/send-email';
import { runUsageMaintenance } from '../../lib/inngest/functions/usage-maintenance';
import {
  _resetMediaDbDepsForTests,
  _setMediaDbDepsForTests,
} from '../../lib/storage/media/client';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C44 Inngest functions. Tests the plain `run*` LOGIC (the createFunction
 * wrappers are thin Inngest glue — idempotency/cron are declarative config,
 * verified by the serve handler at runtime). All deps mocked: pglite for the
 * DB (real RLS), mock R2 adapter, no Resend, no Inngest wire.
 */

let fixture: TestDb;
const planId = '00000000-0000-4000-8000-f00000000001';
const orgA = '77777777-7777-4777-8777-a00000000001';
const orgB = '77777777-7777-4777-8777-b00000000002';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx
      .insert(plans)
      .values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
    for (const [id, slug] of [
      [orgA, 'job-a'],
      [orgB, 'job-b'],
    ] as const) {
      await tx.insert(organizations).values({ id, name: 'Job Org', slug, planId });
    }
  });

  _setMediaDbDepsForTests({
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
    asAdmin: (fn) => runAdmin(fixture.db, fn),
  });
  _setEmailDbDepsForTests((fn) => runAdmin(fixture.db, fn));
  _setOrgTxForTests((orgId, fn) => runAsOrg(fixture.db, orgId, fn));
  _setInngestEmitForTests(null);
}, 60_000);

afterAll(async () => {
  _resetMediaDbDepsForTests();
  _resetEmailDbDepsForTests();
  _resetOrgTxForTests();
  _resetFlagReaderForTests();
  _setInngestEmitForTests(null);
  _setResendSenderForTests(null);
  await fixture.dispose();
});

beforeEach(() => {
  // Flags OFF: storage → mock adapter, email → mock send. Fail-safe.
  _setFlagReaderForTests(() => Promise.resolve('off'));
  _setResendSenderForTests(null);
});

describe('registry', () => {
  it('exposes exactly the four C44 functions', () => {
    expect(functions).toHaveLength(4);
    expect(functions.every(Boolean)).toBe(true);
  });
});

describe('runUsageMaintenance', () => {
  it('is a safe heartbeat (no throw)', async () => {
    await expect(runUsageMaintenance()).resolves.toEqual({ ok: true });
  });
});

describe('runCleanupPendingUploads', () => {
  it('reaps only pending rows older than the cutoff; leaves fresh + ready', async () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const now = new Date();
    const oldPending = '88888888-8888-4888-8888-000000000001';
    const freshPending = '88888888-8888-4888-8888-000000000002';
    const oldReady = '88888888-8888-4888-8888-000000000003';

    await runAdmin(fixture.db, (tx) =>
      tx.insert(mediaAssets).values([
        {
          id: oldPending,
          organizationId: orgA,
          key: `orgs/${orgA}/media/old.png`,
          bucket: 'b',
          contentType: 'image/png',
          sizeBytes: 1,
          originalFilename: 'old.png',
          status: 'pending',
          createdAt: old,
        },
        {
          id: freshPending,
          organizationId: orgA,
          key: `orgs/${orgA}/media/fresh.png`,
          bucket: 'b',
          contentType: 'image/png',
          sizeBytes: 1,
          originalFilename: 'fresh.png',
          status: 'pending',
          createdAt: now,
        },
        {
          id: oldReady,
          organizationId: orgA,
          key: `orgs/${orgA}/media/ready.png`,
          bucket: 'b',
          contentType: 'image/png',
          sizeBytes: 1,
          originalFilename: 'ready.png',
          status: 'ready',
          createdAt: old,
        },
      ]),
    );

    const reaped = await runCleanupPendingUploads();
    expect(reaped).toBe(1);

    const statusOf = async (id: string) => {
      const rows = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
        tx
          .select({ status: mediaAssets.status })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, id)),
      );
      return rows[0]?.status;
    };
    expect(await statusOf(oldPending)).toBe('deleted');
    expect(await statusOf(freshPending)).toBe('pending');
    expect(await statusOf(oldReady)).toBe('ready');
  });
});

describe('runSendEmail', () => {
  it('delegates to performSend and marks the log row sent (mock path)', async () => {
    const ids = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .insert(emailLog)
        .values({ to: 'job@b.test', template: 'generic_notification', status: 'queued' })
        .returning({ id: emailLog.id }),
    );
    const id = ids[0]!.id;
    const status = await runSendEmail({
      emailLogId: id,
      orgId: null,
      template: 'generic_notification',
      to: 'job@b.test',
      locale: 'en',
      payload: { title: 'T', body: 'B' },
    });
    expect(status).toBe('sent');
    const rows = await runAdmin<Array<{ status: string }>>(fixture.db, (tx) =>
      tx.select({ status: emailLog.status }).from(emailLog).where(eq(emailLog.id, id)),
    );
    expect(rows[0]?.status).toBe('sent');
  });
});

describe('runProcessMedia — tenant context from the event orgId', () => {
  const assetId = '99999999-9999-4999-8999-00000000000a';

  beforeEach(async () => {
    await runAdmin(fixture.db, async (tx) => {
      await tx.delete(mediaAssets).where(eq(mediaAssets.id, assetId));
      await tx.insert(mediaAssets).values({
        id: assetId,
        organizationId: orgA,
        key: `orgs/${orgA}/media/proc.png`,
        bucket: 'b',
        contentType: 'image/png',
        sizeBytes: 1,
        originalFilename: 'proc.png',
        status: 'ready',
      });
    });
  });

  it('processes an asset that belongs to the orgId in the event', async () => {
    const seenOrgIds: string[] = [];
    _setOrgTxForTests(<T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => {
      seenOrgIds.push(orgId);
      return runAsOrg(fixture.db, orgId, fn);
    });

    const out = await runProcessMedia({ orgId: orgA, assetId });
    expect(out).toEqual({ processed: true });
    expect(seenOrgIds).toEqual([orgA]); // tenant context pinned to the event org

    _setOrgTxForTests((orgId, fn) => runAsOrg(fixture.db, orgId, fn));
  });

  it('does NOT process a foreign-org asset (RLS hides it → not found)', async () => {
    // orgB asks to process orgA's asset: RLS under orgB filters it out.
    const out = await runProcessMedia({ orgId: orgB, assetId });
    expect(out).toEqual({ processed: false });
  });
});
