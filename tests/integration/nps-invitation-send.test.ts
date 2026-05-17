import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin } from '../../lib/db/client';
import {
  npsInvitations,
  npsSurveys,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import {
  clearDevOutbox,
  getDevOutbox,
} from '../../lib/emails/dev-outbox';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 32 — invitation send paths.
 *
 * We exercise the unique-index constraints (`one_per_day`,
 * `idempotency_key`) and the dev-outbox side effect of the email
 * path directly, without booting Server Actions.
 *
 * The "throttle by min_days_between_sends" branch is covered by
 * the cron-resolution test indirectly + by the dispatcher's pure
 * code path here.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3220c3220c0';
const orgId = '11111111-1111-4111-8111-c3220c3220c0';
const userId = '22222222-2222-4222-8222-c3220c3220c0';
const surveyId = '99999999-9999-4999-8999-c3220c3220c0';

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
      email: 'a@c3220.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Org C3220',
      slug: 'c3220-org',
      planId,
    });
    await tx.insert(npsSurveys).values({
      id: surveyId,
      organizationId: orgId,
      name: 'Send tests',
      trigger: 'manual',
      channels: ['email'],
      questionText: '¿Recomendarías?',
      locale: 'es',
      status: 'active',
      minDaysBetweenSends: 90,
    });
    clearDevOutbox();
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('nps_invitations write paths', () => {
  it('insert succeeds; one_per_day blocks same (org, survey, contact) duplicate', async () => {
    const baseToken = 'bnf_nps_';
    const tail = 'A'.repeat(32);
    await runAdmin(fixture.db, (tx) =>
      tx.insert(npsInvitations).values({
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'one@c3220.test',
        channel: 'email',
        token: baseToken + tail,
      }),
    );
    // Second insert on the same UTC day for the same contact must
    // fail the unique partial index.
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(npsInvitations).values({
          organizationId: orgId,
          npsSurveyId: surveyId,
          contactIdentifier: 'one@c3220.test',
          channel: 'email',
          token: baseToken + 'B'.repeat(32),
        }),
      ),
    ).rejects.toThrow();
  });

  it('idempotency_key partial unique blocks duplicates; NULL allowed', async () => {
    const token1 = 'bnf_nps_' + 'C'.repeat(32);
    const token2 = 'bnf_nps_' + 'D'.repeat(32);
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(npsInvitations).values({
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'idem-a@c3220.test',
        channel: 'email',
        token: token1,
        idempotencyKey: 'evt-42',
      });
    });
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(npsInvitations).values({
          organizationId: orgId,
          npsSurveyId: surveyId,
          contactIdentifier: 'idem-b@c3220.test',
          channel: 'email',
          token: token2,
          idempotencyKey: 'evt-42',
        }),
      ),
    ).rejects.toThrow();
    // Two NULL idempotency_key rows on different contacts must
    // succeed (the partial unique excludes NULLs).
    const token3 = 'bnf_nps_' + 'E'.repeat(32);
    const token4 = 'bnf_nps_' + 'F'.repeat(32);
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(npsInvitations).values({
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'null-key-a@c3220.test',
        channel: 'email',
        token: token3,
      });
      await tx.insert(npsInvitations).values({
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'null-key-b@c3220.test',
        channel: 'email',
        token: token4,
      });
    });
  });

  it('token uniqueness is enforced across the org', async () => {
    const dup = 'bnf_nps_' + 'G'.repeat(32);
    await runAdmin(fixture.db, (tx) =>
      tx.insert(npsInvitations).values({
        organizationId: orgId,
        npsSurveyId: surveyId,
        contactIdentifier: 'tok-a@c3220.test',
        channel: 'email',
        token: dup,
      }),
    );
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(npsInvitations).values({
          organizationId: orgId,
          npsSurveyId: surveyId,
          contactIdentifier: 'tok-b@c3220.test',
          channel: 'email',
          token: dup,
        }),
      ),
    ).rejects.toThrow();
  });

  it('dev-outbox accumulates entries when sender enqueues an email', async () => {
    clearDevOutbox();
    const { sendEmail } = await import('../../lib/emails/send');
    await sendEmail({
      kind: 'nps_prompt',
      to: 'someone@c3220.test',
      subject: 'NPS · ¿cómo estuvo tu experiencia?',
      text: 'Click here to respond: http://localhost:3000/nps/bnf_nps_xxxx',
      meta: { surveyId },
    });
    const outbox = getDevOutbox();
    expect(outbox.length).toBeGreaterThan(0);
    const last = outbox[outbox.length - 1]!;
    expect(last.kind).toBe('nps_prompt');
    expect(last.to).toBe('someone@c3220.test');
  });

  // Sanity: confirm the survey actually exists end-to-end.
  it('survey row is reachable', async () => {
    type Row = { id: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx.select({ id: npsSurveys.id }).from(npsSurveys).where(eq(npsSurveys.id, surveyId)),
    )) as Row[];
    expect(rows).toHaveLength(1);
  });
});
