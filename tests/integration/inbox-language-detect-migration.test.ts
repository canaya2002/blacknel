import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { _clearLruForTests } from '../../lib/ai/cache';
import {
  _resetDbDepsForTests,
  _setDbDepsForTests,
} from '../../lib/ai/persistence';
import { detectLanguage } from '../../lib/inbox/detect-language';
import { sendReplyToThread, type ReplyDeps } from '../../lib/inbox/send-reply';
import { runAdmin, runAs } from '../../lib/db/client';
import {
  aiGenerations,
  contactProfiles,
  inboxMessages,
  inboxThreads,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Commit 24 — language-detect migration.
 *
 * Dual-API per REGLA BLACKNEL AI-FEEDBACK PATTERN:
 *   - Server path: `sendReplyToThread` → async `detectLanguageAi`
 *     → writes ai_generations row with skill='language_detect'
 *     anchored on the LAST INBOUND `inbox_messages.id` (Ajuste 2).
 *   - Client / render path: `detectLanguage` sync — heuristic
 *     stopword. Does NOT touch the adapter (smoke-tested here).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c2403c2403c0';
const orgA = '11111111-1111-4111-8111-c2403c2403c0';
const userA = '22222222-2222-4222-8222-c2403c2403c0';
const contactA = '66666666-6666-4666-8666-c2403c2403c0';
const threadA = '55555555-5555-4555-8555-c2403c2403c0';
const inboundA = '88888888-8888-4888-8888-c2403c2403c0';

const inboxDeps: ReplyDeps = {
  asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
  asAdmin: (fn) => runAdmin(fixture.db, fn),
};

beforeAll(async () => {
  fixture = await createTestDb();
  _setDbDepsForTests({
    asAdmin: (fn) => runAdmin(fixture.db, fn),
    asUser: (ctx, fn) => runAs(fixture.db, ctx, fn),
  });
  await runAdmin(fixture.db, async (tx) => {
    await tx.insert(plans).values({
      id: planId,
      code: 'enterprise',
      name: 'Enterprise',
      priceCents: 109900,
    });
    await tx.insert(users).values({ id: userA, email: 'a@l24.test', name: 'A' });
    await tx.insert(organizations).values({
      id: orgA,
      name: 'Org A',
      slug: 'l24-org-a',
      planId,
    });
    await tx.insert(contactProfiles).values({
      id: contactA,
      organizationId: orgA,
      platform: 'facebook',
      externalId: 'fb-l24-1',
      displayName: 'Cliente',
    });
    await tx.insert(inboxThreads).values({
      id: threadA,
      organizationId: orgA,
      contactProfileId: contactA,
      platform: 'facebook',
      kind: 'dm',
      externalThreadId: 'thr-l24-1',
      lastMessageAt: new Date(),
      status: 'open',
    });
    await tx.insert(inboxMessages).values({
      id: inboundA,
      organizationId: orgA,
      threadId: threadA,
      direction: 'inbound',
      authorType: 'contact',
      authorName: 'Cliente',
      body: 'Hola, gracias por el servicio, todo perfecto, los recomiendo.',
      sentAt: new Date(),
    });
  });
}, 60_000);

afterAll(async () => {
  _resetDbDepsForTests();
  _clearLruForTests();
  await fixture.dispose();
});

afterEach(() => {
  _clearLruForTests();
});

describe('inbox language-detect migration — server async path', () => {
  it('sendReplyToThread writes ai_generations row with skill=language_detect anchored on the LAST INBOUND inbox_messages.id', async () => {
    const result = await sendReplyToThread(
      { orgId: orgA, userId: userA },
      {
        threadId: threadA,
        messageBody: 'Gracias por tu mensaje, todo en orden.',
      },
      inboxDeps,
    );
    expect(result.ok).toBe(true);

    const rows = await runAdmin<
      Array<{ skill: string; entityType: string; entityId: string | null }>
    >(fixture.db, (tx) =>
      tx
        .select({
          skill: aiGenerations.skill,
          entityType: aiGenerations.entityType,
          entityId: aiGenerations.entityId,
        })
        .from(aiGenerations)
        .where(eq(aiGenerations.organizationId, orgA)),
    );
    const langRows = rows.filter((r) => r.skill === 'language_detect');
    expect(langRows.length).toBeGreaterThan(0);
    expect(langRows[0]?.entityType).toBe('inbox_message');
    // Ajuste 2 — anchor on the inbound message id, not the thread.
    expect(langRows[0]?.entityId).toBe(inboundA);
  });

  it('explicit input.language short-circuits the adapter call', async () => {
    // Wipe just-language rows so the assertion is unambiguous.
    await runAdmin(fixture.db, (tx) =>
      tx.delete(aiGenerations).where(eq(aiGenerations.skill, 'language_detect')),
    );

    const result = await sendReplyToThread(
      { orgId: orgA, userId: userA },
      {
        threadId: threadA,
        messageBody: 'Gracias otra vez.',
        language: 'es',
      },
      inboxDeps,
    );
    expect(result.ok).toBe(true);

    const rows = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .select({ id: aiGenerations.id })
        .from(aiGenerations)
        .where(eq(aiGenerations.skill, 'language_detect')),
    );
    expect(rows.length).toBe(0);
  });
});

describe('inbox language-detect — sync render path stays heuristic (REGLA BLACKNEL)', () => {
  it('detectLanguage sync returns a result without touching the adapter', async () => {
    // Wipe existing language_detect rows for this test slice.
    await runAdmin(fixture.db, (tx) =>
      tx.delete(aiGenerations).where(eq(aiGenerations.skill, 'language_detect')),
    );

    const detected = detectLanguage(
      'Hola, gracias por contactarnos. ¿Cómo podemos ayudarte hoy?',
    );
    expect(detected).toBe('es');

    // No DB write — the sync path doesn't go through the
    // adapter / persistence layer.
    const rows = await runAdmin<Array<{ id: string }>>(fixture.db, (tx) =>
      tx
        .select({ id: aiGenerations.id })
        .from(aiGenerations)
        .where(eq(aiGenerations.skill, 'language_detect')),
    );
    expect(rows.length).toBe(0);
  });
});
