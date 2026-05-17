import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  npsInvitations,
  npsResponses,
  npsSurveys,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  loadNpsByToken,
  submitNpsResponse,
} from '../../lib/nps/public-response';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 32 — public submit flow.
 *
 * Drives `loadNpsByToken` + `submitNpsResponse` against a real
 * pglite by injecting a custom `asAdmin` dependency. Same DI seam
 * pattern as the Phase-5 feedback flow.
 *
 * The flow covers four "no" branches (malformed / unknown / expired
 * / already-responded) all returning `null` / `NOT_FOUND` plus the
 * detractor-without-comment rejection at the app layer.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3230c3230c0';
const orgId = '11111111-1111-4111-8111-c3230c3230c0';
const userId = '22222222-2222-4222-8222-c3230c3230c0';
const surveyId = '99999999-9999-4999-8999-c3230c3230c0';
const inviteHappy = 'aaaaaaaa-aaaa-4aaa-8aaa-c3230c3230c0';
const inviteExpired = 'aaaaaaaa-aaaa-4aaa-8aaa-c3230c3230c1';
const inviteDouble = 'aaaaaaaa-aaaa-4aaa-8aaa-c3230c3230c2';
const inviteDetractor = 'aaaaaaaa-aaaa-4aaa-8aaa-c3230c3230c3';
const tokenHappy = 'bnf_nps_' + 'H'.repeat(32);
const tokenExpired = 'bnf_nps_' + 'X'.repeat(32);
const tokenDouble = 'bnf_nps_' + 'Y'.repeat(32);
const tokenDetractor = 'bnf_nps_' + 'Z'.repeat(32);

const deps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) =>
    runAdmin(fixture.db, fn),
};

beforeAll(async () => {
  fixture = await createTestDb();
  const now = new Date();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values({
      id: userId,
      email: 'a@c3230.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Org C3230',
      slug: 'c3230-org',
      planId,
    });
    await tx.insert(npsSurveys).values({
      id: surveyId,
      organizationId: orgId,
      name: 'Public flow',
      trigger: 'manual',
      channels: ['email'],
      questionText: '¿Qué tal?',
      thankYouMessage: '¡Gracias por participar!',
      locale: 'es',
      status: 'active',
      minDaysBetweenSends: 0,
    });
    await tx.insert(npsInvitations).values([
      {
        id: inviteHappy,
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'happy@c3230.test',
        contactName: 'Happy Person',
        channel: 'email',
        token: tokenHappy,
      },
      {
        id: inviteExpired,
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'expired@c3230.test',
        channel: 'email',
        token: tokenExpired,
        // Already past.
        expiresAt: new Date(now.getTime() - 86_400_000),
      },
      {
        id: inviteDouble,
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'double@c3230.test',
        channel: 'email',
        token: tokenDouble,
      },
      {
        id: inviteDetractor,
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'detractor@c3230.test',
        channel: 'email',
        token: tokenDetractor,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('loadNpsByToken / submitNpsResponse', () => {
  it('malformed token short-circuits to null (no DB query)', async () => {
    const r = await loadNpsByToken('not_a_real_token', deps);
    expect(r).toBeNull();
  });

  it('happy path: 9 → promoter, response stored', async () => {
    const r = await submitNpsResponse(
      { token: tokenHappy, score: 9, comment: null },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.category).toBe('promoter');
      expect(r.data.thankYouMessage).toBe('¡Gracias por participar!');
    }
    type Row = { score: number; category: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          score: npsResponses.score,
          category: npsResponses.category,
        })
        .from(npsResponses)
        .where(eq(npsResponses.npsInvitationId, inviteHappy)),
    )) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(9);
    expect(rows[0]!.category).toBe('promoter');
  });

  it('expired token → NOT_FOUND', async () => {
    const r = await submitNpsResponse(
      { token: tokenExpired, score: 8, comment: null },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('NOT_FOUND');
    }
  });

  it('detractor without comment → VALIDATION_ERROR', async () => {
    const r = await submitNpsResponse(
      { token: tokenDetractor, score: 3, comment: null },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('double submit on same token → second returns NOT_FOUND', async () => {
    const first = await submitNpsResponse(
      { token: tokenDouble, score: 10, comment: null },
      deps,
    );
    expect(first.ok).toBe(true);
    const second = await submitNpsResponse(
      { token: tokenDouble, score: 5, comment: 'changed my mind' },
      deps,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('NOT_FOUND');
    }
  });
});
