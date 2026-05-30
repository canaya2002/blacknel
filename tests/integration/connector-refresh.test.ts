import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAsOrg } from '../../lib/db/client';
import { connectedAccounts, organizations, plans } from '../../lib/db/schema';
import { _setEncryptionKeyForTests } from '../../lib/connectors/crypto';
import {
  refreshForPlatform,
  runConnectionTokenRefresh,
  type ConnectionRefreshDeps,
} from '../../lib/connectors/refresh';
import { readAccountTokens, writeAccountTokens, type ConnectionTokens } from '../../lib/connectors/tokens';
import type { TokenExchangeResult } from '../../lib/connectors/oauth/types';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C48 generic connector token refresh — the framework cron that refreshes ALL
 * platforms (not just FB/IG). Per-platform dispatch (mock branch, zero network),
 * multi-platform sweep, failure → status 'expired', and per-org RLS writes.
 */

let fixture: TestDb;
let deps: ConnectionRefreshDeps;

const planId = '00000000-0000-4000-8000-d48000000001';
const orgA = '48044444-4444-4444-8480-a00000000001';
const orgB = '48044444-4444-4444-8480-b00000000002';

const SOON = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // <7d window
const FAR = () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

async function seedAccount(
  id: string,
  org: string,
  platform: string,
  expiresAt: string,
): Promise<void> {
  await runAdmin(fixture.db, (tx) =>
    tx.insert(connectedAccounts).values({
      id,
      organizationId: org,
      platform,
      externalAccountId: `${platform}-${id.slice(-4)}`,
      status: 'connected',
    }),
  );
  await runAsOrg(fixture.db, org, (tx) =>
    writeAccountTokens(tx, id, { accessToken: 'old-token', refreshToken: 'r', expiresAt }),
  );
}

beforeAll(async () => {
  _setEncryptionKeyForTests('c48-refresh-test-key-32-bytes-minimum!!!');
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'growth', name: 'Growth', priceCents: 19900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Ref A', slug: 'ref-a', planId },
      { id: orgB, name: 'Ref B', slug: 'ref-b', planId },
    ]);
  });
  deps = {
    asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
    orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => runAsOrg(fixture.db, orgId, fn),
    refreshFor: refreshForPlatform,
    now: () => new Date(),
  };
});

afterAll(async () => {
  _setEncryptionKeyForTests(null);
  await fixture.dispose();
});

beforeEach(async () => {
  // The cron is system-wide → isolate tests with a clean slate.
  await runAdmin(fixture.db, (tx) => tx.delete(connectedAccounts));
});

describe('refreshForPlatform (mock dispatch, no network)', () => {
  it('dispatches each platform to its refresh + extends the expiry', async () => {
    const tokens: ConnectionTokens = { accessToken: 'a', refreshToken: 'r', expiresAt: SOON() };
    for (const platform of ['facebook', 'instagram', 'linkedin', 'tiktok', 'x', 'youtube']) {
      const res: TokenExchangeResult = await refreshForPlatform(platform, tokens);
      expect(res.accessToken).toBeTruthy();
      expect(res.expiresAt && Date.parse(res.expiresAt) > Date.now()).toBe(true);
    }
  });
});

describe('runConnectionTokenRefresh', () => {
  it('refreshes soon-to-expire connections across multiple platforms + orgs', async () => {
    await seedAccount('48066666-6666-4666-8480-000000000001', orgA, 'facebook', SOON());
    await seedAccount('48066666-6666-4666-8480-000000000002', orgA, 'linkedin', SOON());
    await seedAccount('48066666-6666-4666-8480-000000000003', orgB, 'x', SOON());

    const res = await runConnectionTokenRefresh(deps);
    expect(res).toMatchObject({ refreshed: 3, failed: 0, expired: 0 });

    // All still connected, tokens re-readable under their own org.
    const rows = await runAdmin<Array<{ id: string; status: string; org: string }>>(fixture.db, (tx) =>
      tx
        .select({ id: connectedAccounts.id, status: connectedAccounts.status, org: connectedAccounts.organizationId })
        .from(connectedAccounts),
    );
    expect(rows.every((r) => r.status === 'connected')).toBe(true);
    const liTokens = await runAsOrg(fixture.db, orgA, (tx) =>
      readAccountTokens(tx, '48066666-6666-4666-8480-000000000002'),
    );
    expect(liTokens?.accessToken).toBeTruthy();
  });

  it('skips connections comfortably far from expiry', async () => {
    await seedAccount('48066666-6666-4666-8480-000000000010', orgA, 'youtube', FAR());
    const res = await runConnectionTokenRefresh(deps);
    expect(res.refreshed).toBe(0);
  });

  it('marks a connection expired when its refresh fails (and keeps sweeping)', async () => {
    const failId = '48066666-6666-4666-8480-000000000020';
    const okId = '48066666-6666-4666-8480-000000000021';
    await seedAccount(failId, orgA, 'tiktok', SOON());
    await seedAccount(okId, orgA, 'linkedin', SOON());

    const failingDeps: ConnectionRefreshDeps = {
      ...deps,
      refreshFor: async (platform, tokens) => {
        if (platform === 'tiktok') throw new Error('token revoked');
        return refreshForPlatform(platform, tokens);
      },
    };
    const res = await runConnectionTokenRefresh(failingDeps);
    expect(res).toMatchObject({ refreshed: 1, failed: 1, expired: 1 });

    const statuses = await runAdmin<Array<{ id: string; status: string; err: string | null }>>(fixture.db, (tx) =>
      tx
        .select({ id: connectedAccounts.id, status: connectedAccounts.status, err: connectedAccounts.errorMessage })
        .from(connectedAccounts),
    );
    const failed = statuses.find((s) => s.id === failId)!;
    const ok = statuses.find((s) => s.id === okId)!;
    expect(failed.status).toBe('expired');
    expect(failed.err).toContain('revoked');
    expect(ok.status).toBe('connected');
  });
});
