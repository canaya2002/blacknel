import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, runAs } from '../../lib/db/client';
import { connectedAccounts, organizations, plans, users } from '../../lib/db/schema';
import { _setEncryptionKeyForTests, isEncryptedEnvelope } from '../../lib/connectors/crypto';
import { readAccountTokens, writeAccountTokens } from '../../lib/connectors/tokens';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * C46 connector token store. Tokens are AES-256-GCM encrypted into
 * connected_accounts.oauth_tokens_encrypted, with token_expires_at mirrored
 * plaintext for the refresh cron. Runs against pglite with real RLS: the
 * encrypted blob is never plaintext, and org B cannot read org A's tokens.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-d46000000001';
const orgA = '46a44444-4444-4444-8460-a00000000001';
const orgB = '46a44444-4444-4444-8460-b00000000002';
const userA = '46a55555-5555-4555-8560-a00000000001';
const userB = '46a55555-5555-4555-8560-b00000000002';
const accountA = '46a66666-6666-4666-8660-a00000000001';

beforeAll(async () => {
  _setEncryptionKeyForTests('integration-token-store-key-32-bytes-minimum!!');
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({ id: planId, code: 'standard', name: 'Standard', priceCents: 6900 });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Conn A', slug: 'conn-a', planId },
      { id: orgB, name: 'Conn B', slug: 'conn-b', planId },
    ]);
    await tx.insert(users).values([
      { id: userA, email: 'a@conn.test', name: 'A' },
      { id: userB, email: 'b@conn.test', name: 'B' },
    ]);
    await tx.insert(connectedAccounts).values({
      id: accountA,
      organizationId: orgA,
      platform: 'facebook',
      externalAccountId: 'page-A-1',
      displayName: 'Page A',
    });
  });
}, 60_000);

afterAll(async () => {
  _setEncryptionKeyForTests(null);
  await fixture.dispose();
});

describe('writeAccountTokens / readAccountTokens', () => {
  it('encrypts at rest (no plaintext), mirrors expiry, and roundtrips under the owning org', async () => {
    const tokens = {
      accessToken: 'EAAG-long-lived-page-token',
      refreshToken: 'EAAG-user-token',
      tokenType: 'bearer',
      expiresAt: '2026-08-01T00:00:00.000Z',
      scopes: ['pages_manage_posts', 'instagram_content_publish'],
    };
    await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      writeAccountTokens(tx, accountA, tokens),
    );

    // Raw column: an AES-GCM envelope, NOT the plaintext token.
    const raw = await runAdmin<Array<{ blob: unknown; exp: Date | null }>>(fixture.db, (tx) =>
      tx
        .select({ blob: connectedAccounts.oauthTokensEncrypted, exp: connectedAccounts.tokenExpiresAt })
        .from(connectedAccounts)
        .where(eq(connectedAccounts.id, accountA)),
    );
    expect(isEncryptedEnvelope(raw[0]?.blob)).toBe(true);
    expect(JSON.stringify(raw[0]?.blob)).not.toContain('EAAG-long-lived-page-token');
    expect(raw[0]?.exp?.toISOString()).toBe('2026-08-01T00:00:00.000Z');

    // Decrypt under the owning org.
    const back = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      readAccountTokens(tx, accountA),
    );
    expect(back).toEqual(tokens);
  });

  it('returns null for an account the caller org cannot see (RLS)', async () => {
    const back = await runAs(fixture.db, { orgId: orgB, userId: userB }, (tx) =>
      readAccountTokens(tx, accountA),
    );
    expect(back).toBeNull();
  });

  it('returns null when no tokens were ever stored (empty {})', async () => {
    const freshId = '46a66666-6666-4666-8660-a00000000002';
    await runAdmin(fixture.db, (tx) =>
      tx.insert(connectedAccounts).values({
        id: freshId,
        organizationId: orgA,
        platform: 'instagram',
        externalAccountId: 'ig-A-1',
      }),
    );
    const back = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      readAccountTokens(tx, freshId),
    );
    expect(back).toBeNull();
  });
});
