import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  npsSurveys,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 32 — `nps_surveys` CRUD + tenant isolation.
 *
 * Server Actions need `requireUser()`; we exercise the DB transitions
 * directly via `runAdmin` / `runAs` to verify the RLS, FK behavior,
 * and update semantics that the actions rely on.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3210c3210c0';
const orgA = '11111111-1111-4111-8111-c3210c3210c0';
const orgB = '11111111-1111-4111-8111-c3210c3210c1';
const userA = '22222222-2222-4222-8222-c3210c3210c0';
const userB = '22222222-2222-4222-8222-c3210c3210c1';
const surveyA = '99999999-9999-4999-8999-c3210c3210c0';

beforeAll(async () => {
  fixture = await createTestDb();
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'growth',
      name: 'Growth',
      priceCents: 29900,
    });
    await tx.insert(users).values([
      { id: userA, email: 'a@c3210.test', name: 'A' },
      { id: userB, email: 'b@c3210.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c3210-a', planId },
      { id: orgB, name: 'Org B', slug: 'c3210-b', planId },
    ]);
    await tx.insert(npsSurveys).values({
      id: surveyA,
      organizationId: orgA,
      name: 'Org A survey',
      trigger: 'post_resolution',
      channels: ['email', 'whatsapp'],
      questionText: '¿Recomendarías?',
      locale: 'es',
      status: 'draft',
      minDaysBetweenSends: 90,
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('nps_surveys CRUD', () => {
  it('list returns the org A row', async () => {
    type Row = { id: string; name: string };
    const rows = (await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        tx
          .select({ id: npsSurveys.id, name: npsSurveys.name })
          .from(npsSurveys)
          .where(eq(npsSurveys.organizationId, orgA)),
    )) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Org A survey');
  });

  it('update changes status draft → active', async () => {
    await runAs(
      fixture.db,
      { orgId: orgA, userId: userA },
      (tx) =>
        tx
          .update(npsSurveys)
          .set({ status: 'active', updatedAt: new Date() })
          .where(
            and(
              eq(npsSurveys.organizationId, orgA),
              eq(npsSurveys.id, surveyA),
            ),
          ),
    );
    type Row = { status: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ status: npsSurveys.status })
        .from(npsSurveys)
        .where(eq(npsSurveys.id, surveyA)),
    )) as Row[];
    expect(rows[0]!.status).toBe('active');
  });

  it('channels CHECK rejects empty array', async () => {
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(npsSurveys).values({
          organizationId: orgA,
          name: 'Empty channels',
          trigger: 'manual',
          channels: [],
          questionText: '?',
        }),
      ),
    ).rejects.toThrow();
  });

  it('tenant isolation: org B sees no Org A surveys', async () => {
    type Row = { id: string };
    const rows = (await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) => tx.select({ id: npsSurveys.id }).from(npsSurveys),
    )) as Row[];
    expect(rows).toHaveLength(0);
  });
});
