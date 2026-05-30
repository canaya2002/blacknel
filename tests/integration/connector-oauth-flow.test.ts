import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AnyPgTx, runAdmin, runAs } from '../../lib/db/client';
import { connectedAccounts, organizations, plans, users } from '../../lib/db/schema';
import { _setEncryptionKeyForTests, encryptJson, isEncryptedEnvelope } from '../../lib/connectors/crypto';
import { signOAuthState } from '../../lib/connectors/oauth-state';
import { handleCallback, startOAuth } from '../../lib/connectors/oauth/flow';
import { getOAuthProvider, OAUTH_PROVIDER_PLATFORMS } from '../../lib/connectors/oauth/registry';
import { incrementUsage } from '../../lib/usage/counters';
import { type PersistDeps } from '../../lib/connectors/persist';
import { readAccountTokens } from '../../lib/connectors/tokens';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C47 generic OAuth connect flow — provider registry + state CSRF (incl. X PKCE)
 * + per-platform mock listAccounts + seat-gated persistence with encrypted
 * tokens, tenant-scoped. isReal*Enabled is false (no creds) so every provider
 * takes its mock branch; zero network.
 */

let fixture: TestDb;
let deps: PersistDeps;

const planId = '00000000-0000-4000-8000-d47000000001';
const orgId = '47044444-4444-4444-8470-a00000000001';
const otherOrg = '47044444-4444-4444-8470-b00000000002';
const userId = '47055555-5555-4555-8570-a00000000001';

const PLATFORMS = ['linkedin', 'tiktok', 'x', 'youtube'] as const;

function stateFromRedirect(url: string): string {
  return new URL(url).searchParams.get('state') ?? '';
}

beforeAll(async () => {
  _setEncryptionKeyForTests('c47-oauth-flow-test-key-32-bytes-minimum!!');
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'growth', name: 'Growth', priceCents: 19900 });
    await tx.insert(organizations).values([
      { id: orgId, name: 'Flow Org', slug: 'flow-org', planId },
      { id: otherOrg, name: 'Other Org', slug: 'other-org', planId },
    ]);
    await tx.insert(users).values({ id: userId, email: 'f@flow.test', name: 'F' });
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

describe('provider registry', () => {
  it('exposes the four batch-2 providers and nothing else', () => {
    expect([...OAUTH_PROVIDER_PLATFORMS].sort()).toEqual(['linkedin', 'tiktok', 'x', 'youtube']);
    expect(getOAuthProvider('bogus')).toBeNull();
    expect(getOAuthProvider('linkedin')?.platform).toBe('linkedin');
    expect(getOAuthProvider('x')?.usesPkce).toBe(true);
  });
});

describe('startOAuth (mock bounce when real disabled)', () => {
  it('redirects to our callback with a signed state per platform', async () => {
    for (const platform of PLATFORMS) {
      const { redirectUrl } = await startOAuth({ orgId, userId, platform });
      expect(redirectUrl).toContain(`/api/connectors/${platform}/callback`);
      expect(redirectUrl).toContain('mock=1');
      expect(stateFromRedirect(redirectUrl).length).toBeGreaterThan(0);
    }
  });
});

describe('handleCallback — connect each platform (mock)', () => {
  it('persists accounts with encrypted tokens, scoped to the org', async () => {
    for (const platform of PLATFORMS) {
      const { redirectUrl } = await startOAuth({ orgId, userId, platform });
      const state = stateFromRedirect(redirectUrl);
      const r = await handleCallback(
        { orgId, userId, planCode: 'growth', platform, params: { state, code: null, error: null } },
        deps,
      );
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') expect(r.result.accountIds.length).toBeGreaterThanOrEqual(1);
    }

    const rows = await runAdmin<Array<{ platform: string; blob: unknown; org: string }>>(fixture.db, (tx) =>
      tx
        .select({
          platform: connectedAccounts.platform,
          blob: connectedAccounts.oauthTokensEncrypted,
          org: connectedAccounts.organizationId,
        })
        .from(connectedAccounts)
        .where(eq(connectedAccounts.organizationId, orgId)),
    );
    // linkedin returns 2 (member + company), the rest 1 each → 5 total.
    expect(rows.length).toBe(5);
    expect(new Set(rows.map((r) => r.platform))).toEqual(
      new Set(['linkedin', 'tiktok', 'x', 'youtube']),
    );
    for (const row of rows) {
      expect(row.org).toBe(orgId);
      expect(isEncryptedEnvelope(row.blob)).toBe(true);
    }
    // Tokens decrypt under the owning org.
    const oneId = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx.select({ id: connectedAccounts.id }).from(connectedAccounts).where(eq(connectedAccounts.platform, 'x')),
    );
    const tokens = await runAs(fixture.db, { orgId, userId }, (tx) =>
      readAccountTokens(tx, oneId[0]!.id),
    );
    expect(tokens?.accessToken).toContain('mock-x-token');
  });
});

describe('handleCallback — CSRF + provider guards', () => {
  it('rejects an unknown provider', async () => {
    const r = await handleCallback(
      { orgId, userId, planCode: 'growth', platform: 'bogus', params: { state: 'x', code: null, error: null } },
      deps,
    );
    expect(r.kind).toBe('invalid_provider');
  });

  it('rejects a user-denied callback', async () => {
    const { redirectUrl } = await startOAuth({ orgId, userId, platform: 'tiktok' });
    const r = await handleCallback(
      {
        orgId,
        userId,
        planCode: 'growth',
        platform: 'tiktok',
        params: { state: stateFromRedirect(redirectUrl), code: null, error: 'access_denied' },
      },
      deps,
    );
    expect(r.kind).toBe('denied');
  });

  it('rejects a state bound to a different org (cross-tenant)', async () => {
    // State signed for `otherOrg`, replayed against `orgId`'s session.
    const { redirectUrl } = await startOAuth({ orgId: otherOrg, userId, platform: 'linkedin' });
    const r = await handleCallback(
      {
        orgId,
        userId,
        planCode: 'growth',
        platform: 'linkedin',
        params: { state: stateFromRedirect(redirectUrl), code: null, error: null },
      },
      deps,
    );
    expect(r.kind).toBe('state_mismatch');
  });

  it('rejects a state for a different platform', async () => {
    const { redirectUrl } = await startOAuth({ orgId, userId, platform: 'x' });
    const r = await handleCallback(
      {
        orgId,
        userId,
        planCode: 'growth',
        platform: 'youtube',
        params: { state: stateFromRedirect(redirectUrl), code: null, error: null },
      },
      deps,
    );
    expect(r.kind).toBe('invalid_state');
  });

  it('rejects an X callback whose state lacks the PKCE verifier', async () => {
    // State signed without the PKCE extra → the flow must reject (no empty-verifier fallback).
    const state = signOAuthState({ orgId, userId, platform: 'x' });
    const r = await handleCallback(
      { orgId, userId, planCode: 'growth', platform: 'x', params: { state, code: null, error: null } },
      deps,
    );
    expect(r.kind).toBe('invalid_state');
  });

  it('rejects an expired state', async () => {
    const envelope = encryptJson({
      orgId,
      userId,
      platform: 'linkedin',
      nonce: 'x',
      exp: Date.now() - 1000,
    });
    const expired = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
    const r = await handleCallback(
      { orgId, userId, planCode: 'growth', platform: 'linkedin', params: { state: expired, code: null, error: null } },
      deps,
    );
    expect(r.kind).toBe('invalid_state');
  });
});

describe('handleCallback — plan seat cap (batch-2)', () => {
  it('skips accounts over the cap instead of dropping silently', async () => {
    const capPlan = '00000000-0000-4000-8000-d47000000099';
    const capOrg = '47044444-4444-4444-8470-c00000000003';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(plans).values({ id: capPlan, code: 'standard', name: 'Standard', priceCents: 6900 });
      await tx.insert(organizations).values({ id: capOrg, name: 'Cap', slug: 'cap-flow', planId: capPlan });
      await incrementUsage(tx, capOrg, 'socialAccounts', 5); // standard socialAccounts cap = 5
    });
    const { redirectUrl } = await startOAuth({ orgId: capOrg, userId, platform: 'linkedin' });
    const r = await handleCallback(
      {
        orgId: capOrg,
        userId,
        planCode: 'standard',
        platform: 'linkedin',
        params: { state: stateFromRedirect(redirectUrl), code: null, error: null },
      },
      deps,
    );
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.result.connected).toBe(0);
      expect(r.result.skippedForPlan).toBe(2); // linkedin mock = member + company
    }
  });
});
