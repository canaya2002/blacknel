import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import { connectedAccounts, organizations, plans, users } from '../../lib/db/schema';
import { _setEncryptionKeyForTests, encryptJson, isEncryptedEnvelope } from '../../lib/connectors/crypto';
import { persistMetaAccounts, type PersistMetaDeps } from '../../lib/connectors/meta/connect';
import {
  exchangeCodeForTokens,
  listManagedAccounts,
  signState,
  verifyState,
  type ManagedAccount,
} from '../../lib/connectors/meta/oauth';
import { readAccountTokens } from '../../lib/connectors/tokens';
import { PLANS } from '../../lib/plans/plans';
import { readUsage } from '../../lib/usage/counters';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C46 Meta OAuth (P0). State CSRF (sign/verify/tamper/expiry/wrong-key), the
 * mock exchange + account listing, and persisting accounts as connected_accounts
 * with ENCRYPTED tokens — idempotent re-connect, seat accounting, and the plan
 * cap. pglite + RLS; zero network (useRealMeta off → mock).
 */

let fixture: TestDb;
let deps: PersistMetaDeps;

const planId = '00000000-0000-4000-8000-d46100000001';
const orgMain = '46b44444-4444-4444-8461-a00000000001';
const orgCap = '46b44444-4444-4444-8461-b00000000002';
const userMain = '46b55555-5555-4555-8561-a00000000001';

const SOCIAL_CAP = PLANS.standard.limits.socialAccounts;

const fbAccount: ManagedAccount = {
  platform: 'facebook',
  externalId: 'page-100',
  name: 'Brand Page',
  handle: '@brand',
  accessToken: 'EAAG-page-100-token',
  tokenExpiresAt: '2026-09-01T00:00:00.000Z',
};
const igAccount: ManagedAccount = {
  platform: 'instagram',
  externalId: 'ig-200',
  name: 'brand_ig',
  handle: '@brand_ig',
  accessToken: 'EAAG-page-100-token',
  tokenExpiresAt: null,
  parentPageId: 'page-100',
};

beforeAll(async () => {
  _setEncryptionKeyForTests('meta-oauth-test-encryption-key-32-bytes!!');
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
    await tx.insert(organizations).values([
      { id: orgMain, name: 'OAuth Main', slug: 'oauth-main', planId },
      { id: orgCap, name: 'OAuth Cap', slug: 'oauth-cap', planId },
    ]);
    await tx.insert(users).values({ id: userMain, email: 'm@oauth.test', name: 'M' });
  });
  deps = {
    asUser: <T>(ctx: { orgId: string; userId: string }, fn: (tx: AnyPgTx) => Promise<T>) =>
      runAs(fixture.db, ctx, fn),
    asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => runAdmin(fixture.db, fn),
  };
});

afterAll(async () => {
  _setEncryptionKeyForTests(null);
  await fixture.dispose();
});

describe('OAuth state (CSRF)', () => {
  it('roundtrips org+user', () => {
    const token = signState({ orgId: orgMain, userId: userMain });
    expect(verifyState(token)).toEqual({ orgId: orgMain, userId: userMain });
  });

  it('rejects a tampered token', () => {
    const token = signState({ orgId: orgMain, userId: userMain });
    const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(verifyState(tampered)).toBeNull();
  });

  it('rejects an expired token', () => {
    const env = encryptJson({ orgId: orgMain, userId: userMain, nonce: 'x', exp: Date.now() - 1000 });
    const expired = Buffer.from(JSON.stringify(env), 'utf8').toString('base64url');
    expect(verifyState(expired)).toBeNull();
  });

  it('rejects a token sealed with a different key', () => {
    const token = signState({ orgId: orgMain, userId: userMain });
    _setEncryptionKeyForTests('a-different-oauth-state-key-32-bytes-min!!');
    expect(verifyState(token)).toBeNull();
    _setEncryptionKeyForTests('meta-oauth-test-encryption-key-32-bytes!!');
  });
});

describe('mock exchange + listing (useRealMeta off)', () => {
  it('returns a mock user token and fake FB + IG accounts', async () => {
    const { userAccessToken } = await exchangeCodeForTokens('abc123');
    expect(userAccessToken).toContain('mock-user-token');
    const accounts = await listManagedAccounts(userAccessToken);
    expect(accounts.map((a) => a.platform).sort()).toEqual(['facebook', 'instagram']);
    expect(accounts.find((a) => a.platform === 'instagram')?.parentPageId).toBeTruthy();
  });
});

describe('persistMetaAccounts', () => {
  it('creates connected_accounts with encrypted tokens, seats, and metadata', async () => {
    const result = await persistMetaAccounts(
      { orgId: orgMain, userId: userMain, planCode: 'standard', accounts: [fbAccount, igAccount] },
      deps,
    );
    expect(result.connected).toBe(2);
    expect(result.skippedForPlan).toBe(0);

    const rows = await runAdmin<
      Array<{ id: string; platform: string; blob: unknown; metadata: unknown; caps: unknown }>
    >(fixture.db, (tx) =>
      tx
        .select({
          id: connectedAccounts.id,
          platform: connectedAccounts.platform,
          blob: connectedAccounts.oauthTokensEncrypted,
          metadata: connectedAccounts.metadata,
          caps: connectedAccounts.capabilities,
        })
        .from(connectedAccounts)
        .where(eq(connectedAccounts.organizationId, orgMain)),
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(isEncryptedEnvelope(r.blob)).toBe(true);
      expect((r.metadata as { provider?: string }).provider).toBe('meta');
      expect(Array.isArray(r.caps)).toBe(true);
    }
    const ig = rows.find((r) => r.platform === 'instagram')!;
    expect((ig.metadata as { parentPageId?: string }).parentPageId).toBe('page-100');

    // Tokens decrypt under the owning org.
    const tokens = await runAs(fixture.db, { orgId: orgMain, userId: userMain }, (tx) =>
      readAccountTokens(tx, rows[0]!.id),
    );
    expect(tokens?.accessToken).toBe('EAAG-page-100-token');

    // Seats charged once per new account.
    const usage = await runAdmin<number>(fixture.db, (tx) => readUsage(tx, orgMain, 'socialAccounts'));
    expect(usage).toBe(2);
  });

  it('is idempotent on re-connect — no duplicate rows or extra seats', async () => {
    const result = await persistMetaAccounts(
      { orgId: orgMain, userId: userMain, planCode: 'standard', accounts: [fbAccount, igAccount] },
      deps,
    );
    expect(result.connected).toBe(0); // both already existed → updated, not seated
    const rows = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: connectedAccounts.id }).from(connectedAccounts).where(eq(connectedAccounts.organizationId, orgMain)),
    );
    expect(rows).toHaveLength(2);
    const usage = await runAdmin<number>(fixture.db, (tx) => readUsage(tx, orgMain, 'socialAccounts'));
    expect(usage).toBe(2);
  });

  it('respects the plan seat cap — overflow accounts are skipped, not dropped silently', async () => {
    // Pin usage at the cap so no new account fits.
    await runAdmin(fixture.db, (tx) =>
      // counter helper imported below
      incrementTo(tx, orgCap, SOCIAL_CAP),
    );
    const result = await persistMetaAccounts(
      { orgId: orgCap, userId: userMain, planCode: 'standard', accounts: [fbAccount] },
      deps,
    );
    expect(result.connected).toBe(0);
    expect(result.skippedForPlan).toBe(1);
  });
});

// Local helper: bump socialAccounts to a target value.
async function incrementTo(tx: AnyPgTx, orgId: string, target: number): Promise<void> {
  const { incrementUsage } = await import('../../lib/usage/counters');
  await incrementUsage(tx, orgId, 'socialAccounts', target);
}
