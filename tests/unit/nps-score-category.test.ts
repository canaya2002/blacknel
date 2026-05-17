import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin } from '../../lib/db/client';
import {
  npsInvitations,
  npsResponses,
  npsSurveys,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 32 — `nps_responses.category` GENERATED column
 * boundary tests (R-32-1 / D-32-6 verification).
 *
 * The bucket is declared SQL-side as:
 *
 *   score ≥ 9 → promoter
 *   7-8       → passive
 *   0-6       → detractor
 *
 * Inserting at the boundaries (0, 6, 7, 8, 9, 10) and reading back
 * `category` is the only way to prove the GENERATED expression is
 * what we intended without re-implementing the rule in TS.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3200c3200c0';
const orgId = '11111111-1111-4111-8111-c3200c3200c0';
const userId = '22222222-2222-4222-8222-c3200c3200c0';
const surveyId = '99999999-9999-4999-8999-c3200c3200c0';

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
      email: 'a@c32-cat.test',
      name: 'Score Cat User',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Cat Org',
      slug: 'c32-cat-org',
      planId,
    });
    await tx.insert(npsSurveys).values({
      id: surveyId,
      organizationId: orgId,
      name: 'Boundary survey',
      trigger: 'manual',
      channels: ['email'],
      questionText: '¿Probabilidad de recomendar?',
      locale: 'es',
      status: 'active',
      minDaysBetweenSends: 0,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('nps_responses.category GENERATED column', () => {
  it('score 0..6 → detractor; comment required by CHECK', async () => {
    const scores: ReadonlyArray<number> = [0, 3, 6];
    for (let i = 0; i < scores.length; i += 1) {
      const score = scores[i]!;
      const invitationId = `aaaaaaaa-aaaa-4aaa-8aaa-c3200000${String(i + 1).padStart(4, '0')}`;
      const token = `bnf_nps_${'D'.repeat(28)}${String(i)}${String(0)}${String(0)}${String(0)}`;
      await runAdmin(fixture.db, async (tx) => {
        await tx.insert(npsInvitations).values({
          id: invitationId,
          organizationId: orgId,
          npsSurveyId: surveyId,
          contactIdentifier: `detractor-${i}@c32.test`,
          channel: 'email',
          token,
        });
        await tx.insert(npsResponses).values({
          organizationId: orgId,
          npsInvitationId: invitationId,
          score,
          comment: 'needs improvement',
        });
      });
    }
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          score: npsResponses.score,
          category: npsResponses.category,
        })
        .from(npsResponses)
        .innerJoin(
          npsInvitations,
          eq(npsInvitations.id, npsResponses.npsInvitationId),
        )
        .where(eq(npsInvitations.npsSurveyId, surveyId)),
    )) as Array<{ score: number; category: string }>;
    const detractors = rows.filter((r) => scores.includes(r.score));
    expect(detractors).toHaveLength(3);
    for (const d of detractors) {
      expect(d.category).toBe('detractor');
    }
  });

  it('score 7..8 → passive; no comment required', async () => {
    const scores: ReadonlyArray<number> = [7, 8];
    for (let i = 0; i < scores.length; i += 1) {
      const score = scores[i]!;
      const invitationId = `aaaaaaaa-aaaa-4aaa-8aaa-c3200001${String(i + 1).padStart(4, '0')}`;
      const token = `bnf_nps_${'P'.repeat(28)}${String(i)}${String(0)}${String(0)}${String(0)}`;
      await runAdmin(fixture.db, async (tx) => {
        await tx.insert(npsInvitations).values({
          id: invitationId,
          organizationId: orgId,
          npsSurveyId: surveyId,
          contactIdentifier: `passive-${i}@c32.test`,
          channel: 'email',
          token,
        });
        // No comment — passive bucket allows that.
        await tx.insert(npsResponses).values({
          organizationId: orgId,
          npsInvitationId: invitationId,
          score,
        });
      });
    }
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          score: npsResponses.score,
          category: npsResponses.category,
        })
        .from(npsResponses)
        .innerJoin(
          npsInvitations,
          eq(npsInvitations.id, npsResponses.npsInvitationId),
        )
        .where(eq(npsInvitations.npsSurveyId, surveyId)),
    )) as Array<{ score: number; category: string }>;
    const passives = rows.filter((r) => scores.includes(r.score));
    expect(passives).toHaveLength(2);
    for (const p of passives) {
      expect(p.category).toBe('passive');
    }
  });

  it('score 9..10 → promoter', async () => {
    const scores: ReadonlyArray<number> = [9, 10];
    for (let i = 0; i < scores.length; i += 1) {
      const score = scores[i]!;
      const invitationId = `aaaaaaaa-aaaa-4aaa-8aaa-c3200002${String(i + 1).padStart(4, '0')}`;
      const token = `bnf_nps_${'X'.repeat(28)}${String(i)}${String(0)}${String(0)}${String(0)}`;
      await runAdmin(fixture.db, async (tx) => {
        await tx.insert(npsInvitations).values({
          id: invitationId,
          organizationId: orgId,
          npsSurveyId: surveyId,
          contactIdentifier: `promoter-${i}@c32.test`,
          channel: 'email',
          token,
        });
        await tx.insert(npsResponses).values({
          organizationId: orgId,
          npsInvitationId: invitationId,
          score,
        });
      });
    }
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          score: npsResponses.score,
          category: npsResponses.category,
        })
        .from(npsResponses)
        .innerJoin(
          npsInvitations,
          eq(npsInvitations.id, npsResponses.npsInvitationId),
        )
        .where(eq(npsInvitations.npsSurveyId, surveyId)),
    )) as Array<{ score: number; category: string }>;
    const promoters = rows.filter((r) => scores.includes(r.score));
    expect(promoters).toHaveLength(2);
    for (const p of promoters) {
      expect(p.category).toBe('promoter');
    }
  });

  it('detractor (score ≤ 6) without comment violates CHECK', async () => {
    const invitationId = 'aaaaaaaa-aaaa-4aaa-8aaa-c32000099999';
    const token = `bnf_nps_${'Y'.repeat(28)}999`;
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(npsInvitations).values({
        id: invitationId,
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'no-comment@c32.test',
        channel: 'email',
        token,
      });
    });
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(npsResponses).values({
          organizationId: orgId,
          npsInvitationId: invitationId,
          score: 4,
          // comment intentionally null.
        }),
      ),
    ).rejects.toThrow();
  });
});
