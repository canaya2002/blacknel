import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runAdmin, type AnyPgTx } from '../../lib/db/client';
import {
  contactProfiles,
  inboxThreads,
  npsSurveys,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  runPostResolutionTick,
  type PostResolutionDeps,
} from '../../lib/nps/triggers';
import { createTestDb, type TestDb } from '../helpers/test-db';
import { ok, type Result } from '../../lib/types/result';
import type {
  DispatchInvitationInput,
  DispatchOutcome,
} from '../../lib/nps/sender';

/**
 * Phase 9 / Commit 32 — post-resolution cron behavior.
 *
 * Test injects a spy `dispatch` so we can verify the producer's
 * grouping + filtering logic without actually inserting invitations
 * (the sender's DB writes are exercised in `nps-invitation-send.
 * test.ts`).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3240c3240c0';
const orgA = '11111111-1111-4111-8111-c3240c3240c0';
const orgB = '11111111-1111-4111-8111-c3240c3240c1';
const userA = '22222222-2222-4222-8222-c3240c3240c0';
const contactA = 'dddddddd-dddd-4ddd-8ddd-c3240c3240c0';
const contactB = 'dddddddd-dddd-4ddd-8ddd-c3240c3240c1';
const threadClosedRecent = 'eeeeeeee-eeee-4eee-8eee-c3240c3240c0';
const threadClosedOld = 'eeeeeeee-eeee-4eee-8eee-c3240c3240c1';
const threadOpen = 'eeeeeeee-eeee-4eee-8eee-c3240c3240c2';
const surveyActiveA = '99999999-9999-4999-8999-c3240c3240c0';
const surveyDraftA = '99999999-9999-4999-8999-c3240c3240c1';

let dispatchCalls: DispatchInvitationInput[] = [];

const deps: PostResolutionDeps = {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) =>
    runAdmin(fixture.db, fn),
  dispatch: async (
    input: DispatchInvitationInput,
  ): Promise<Result<DispatchOutcome>> => {
    dispatchCalls.push(input);
    return ok({
      kind: 'sent',
      invitation: {
        invitationId: 'fake-invitation-id',
        token: 'bnf_nps_' + 'X'.repeat(32),
        sentAt: input.now ?? new Date(),
      },
    });
  },
};

beforeAll(async () => {
  fixture = await createTestDb();
  const now = new Date();
  const recent = new Date(now.getTime() - 2 * 60 * 60_000);
  const old = new Date(now.getTime() - 48 * 60 * 60_000);

  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values({
      id: userA,
      email: 'a@c3240.test',
      name: 'A',
    });
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c3240-a', planId },
      { id: orgB, name: 'Org B', slug: 'c3240-b', planId },
    ]);
    await tx.insert(contactProfiles).values([
      {
        id: contactA,
        organizationId: orgA,
        platform: 'whatsapp',
        externalId: '+52 55 1234 1111',
        displayName: 'Contact A',
      },
      {
        id: contactB,
        organizationId: orgA,
        platform: 'whatsapp',
        externalId: '+52 55 1234 2222',
        displayName: 'Contact B',
      },
    ]);
    await tx.insert(inboxThreads).values([
      {
        id: threadClosedRecent,
        organizationId: orgA,
        contactProfileId: contactA,
        platform: 'whatsapp',
        externalThreadId: '+52 55 1234 1111',
        kind: 'dm',
        status: 'closed',
        closedAt: recent,
        lastMessageAt: recent,
      },
      {
        id: threadClosedOld,
        organizationId: orgA,
        contactProfileId: contactB,
        platform: 'whatsapp',
        externalThreadId: '+52 55 1234 2222',
        kind: 'dm',
        status: 'closed',
        closedAt: old,
        lastMessageAt: old,
      },
      {
        id: threadOpen,
        organizationId: orgA,
        contactProfileId: contactA,
        platform: 'whatsapp',
        externalThreadId: '+52 55 1234 3333',
        kind: 'dm',
        status: 'open',
        lastMessageAt: now,
      },
    ]);
    await tx.insert(npsSurveys).values([
      {
        id: surveyActiveA,
        organizationId: orgA,
        name: 'Active PR survey',
        trigger: 'post_resolution',
        channels: ['email'],
        questionText: '¿?',
        locale: 'es',
        status: 'active',
        minDaysBetweenSends: 0,
      },
      {
        id: surveyDraftA,
        organizationId: orgA,
        name: 'Draft PR survey',
        trigger: 'post_resolution',
        channels: ['email'],
        questionText: '¿?',
        locale: 'es',
        status: 'draft',
        minDaysBetweenSends: 0,
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('runPostResolutionTick', () => {
  it('dispatches one invitation per (closed thread × active survey) in the 24h window', async () => {
    dispatchCalls = [];
    const result = await runPostResolutionTick({ deps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the recent closed thread + active survey combo.
    expect(result.data.threadsConsidered).toBe(1);
    expect(result.data.invitationsSent).toBe(1);
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]!.surveyId).toBe(surveyActiveA);
    expect(dispatchCalls[0]!.contactIdentifier).toBe('+52 55 1234 1111');
    // Draft survey must NOT receive the candidate.
    for (const call of dispatchCalls) {
      expect(call.surveyId).not.toBe(surveyDraftA);
    }
  });

  it('no closed threads in window → no dispatch', async () => {
    dispatchCalls = [];
    // 100 hours in the future so the recent thread is OUTSIDE the
    // 24h window from `now`.
    const future = new Date(Date.now() + 100 * 60 * 60_000);
    const result = await runPostResolutionTick({ now: future, deps });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threadsConsidered).toBe(0);
    expect(result.data.invitationsSent).toBe(0);
    expect(dispatchCalls).toHaveLength(0);
  });
});
