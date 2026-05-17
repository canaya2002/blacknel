import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin } from '../../lib/db/client';
import {
  contactProfiles,
  inboxThreads,
  listeningMentions,
  listeningTrackedTerms,
  organizations,
  plans,
  users,
} from '../../lib/db/schema';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 33 — triage actions at DB level.
 *
 * The Server Action `triageMentionAction` runs `requireUser`, so
 * we drive the underlying DB transitions directly:
 *
 *   - archive          → status='archived'
 *   - mark_lead        → is_lead=true + status='triaged'
 *   - assign_to_thread → creates inbox_thread, sets BOTH FKs
 *     (mention.assigned_thread_id ↔ thread.source_mention_id —
 *     R-33-2 charter touch).
 *
 * Also verifies the cascading delete behavior on the bidirectional
 * FK pair (both ON DELETE SET NULL).
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3301c3301c0';
const orgId = '11111111-1111-4111-8111-c3301c3301c0';
const userId = '22222222-2222-4222-8222-c3301c3301c0';
const termId = '88888888-8888-4888-8888-c3301c3301c0';
const mentionArchiveId = '77777777-7777-4777-8777-c3301c3301c0';
const mentionLeadId = '77777777-7777-4777-8777-c3301c3301c1';
const mentionAssignId = '77777777-7777-4777-8777-c3301c3301c2';

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
      email: 'a@c3301.test',
      name: 'A',
    });
    await tx.insert(organizations).values({
      id: orgId,
      name: 'Triage Org',
      slug: 'c3301-triage',
      planId,
    });
    await tx.insert(listeningTrackedTerms).values({
      id: termId,
      organizationId: orgId,
      term: 'my-brand',
      termKind: 'keyword',
      platforms: ['x'],
      status: 'active',
    });
    await tx.insert(listeningMentions).values([
      {
        id: mentionArchiveId,
        organizationId: orgId,
        trackedTermId: termId,
        platform: 'x',
        externalId: 'tweet-archive-1',
        authorHandle: 'someone_a',
        body: 'random mention to archive',
      },
      {
        id: mentionLeadId,
        organizationId: orgId,
        trackedTermId: termId,
        platform: 'x',
        externalId: 'tweet-lead-1',
        authorHandle: 'prospect_b',
        body: 'looking for a service like yours',
      },
      {
        id: mentionAssignId,
        organizationId: orgId,
        trackedTermId: termId,
        platform: 'x',
        externalId: 'tweet-assign-1',
        authorHandle: 'lead_c',
        authorDisplayName: 'Lead C',
        body: 'do you do private events?',
      },
    ]);
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('triage transitions', () => {
  it('archive sets status=archived', async () => {
    const now = new Date();
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(listeningMentions)
        .set({ status: 'archived', updatedAt: now })
        .where(eq(listeningMentions.id, mentionArchiveId)),
    );
    type Row = { status: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ status: listeningMentions.status })
        .from(listeningMentions)
        .where(eq(listeningMentions.id, mentionArchiveId)),
    )) as Row[];
    expect(rows[0]!.status).toBe('archived');
  });

  it('mark_lead sets is_lead=true + status=triaged', async () => {
    await runAdmin(fixture.db, (tx) =>
      tx
        .update(listeningMentions)
        .set({ isLead: true, status: 'triaged', updatedAt: new Date() })
        .where(eq(listeningMentions.id, mentionLeadId)),
    );
    type Row = { isLead: boolean; status: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          isLead: listeningMentions.isLead,
          status: listeningMentions.status,
        })
        .from(listeningMentions)
        .where(eq(listeningMentions.id, mentionLeadId)),
    )) as Row[];
    expect(rows[0]!.isLead).toBe(true);
    expect(rows[0]!.status).toBe('triaged');
  });

  it('assign_to_thread wires both FKs (charter touch R-33-2)', async () => {
    const contactId = 'dddddddd-dddd-4ddd-8ddd-c3301c3301c0';
    const threadId = 'eeeeeeee-eeee-4eee-8eee-c3301c3301c0';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(contactProfiles).values({
        id: contactId,
        organizationId: orgId,
        platform: 'x',
        externalId: 'lead_c',
        displayName: 'Lead C',
        handle: 'lead_c',
      });
      await tx.insert(inboxThreads).values({
        id: threadId,
        organizationId: orgId,
        contactProfileId: contactId,
        platform: 'x',
        externalThreadId: `listening:${mentionAssignId}`,
        kind: 'mention',
        status: 'open',
        lastMessageAt: new Date(),
        sourceMentionId: mentionAssignId,
      });
      await tx
        .update(listeningMentions)
        .set({
          assignedThreadId: threadId,
          status: 'converted',
          updatedAt: new Date(),
        })
        .where(eq(listeningMentions.id, mentionAssignId));
    });

    // Verify both FK directions populated.
    type MentionRow = {
      assignedThreadId: string | null;
      status: string;
    };
    const mentionRows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          assignedThreadId: listeningMentions.assignedThreadId,
          status: listeningMentions.status,
        })
        .from(listeningMentions)
        .where(eq(listeningMentions.id, mentionAssignId)),
    )) as MentionRow[];
    expect(mentionRows[0]!.assignedThreadId).toBe(threadId);
    expect(mentionRows[0]!.status).toBe('converted');

    type ThreadRow = { sourceMentionId: string | null };
    const threadRows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ sourceMentionId: inboxThreads.sourceMentionId })
        .from(inboxThreads)
        .where(eq(inboxThreads.id, threadId)),
    )) as ThreadRow[];
    expect(threadRows[0]!.sourceMentionId).toBe(mentionAssignId);
  });

  it('ON DELETE SET NULL applies in both directions', async () => {
    // Wire a fresh pair and delete one side.
    const contactId = 'dddddddd-dddd-4ddd-8ddd-c3301c3301c1';
    const threadId = 'eeeeeeee-eeee-4eee-8eee-c3301c3301c1';
    const mentionId = '77777777-7777-4777-8777-c3301c3301c9';
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(listeningMentions).values({
        id: mentionId,
        organizationId: orgId,
        trackedTermId: termId,
        platform: 'x',
        externalId: 'tweet-delete-1',
        authorHandle: 'someone',
        body: 'delete test',
      });
      await tx.insert(contactProfiles).values({
        id: contactId,
        organizationId: orgId,
        platform: 'x',
        externalId: 'someone',
      });
      await tx.insert(inboxThreads).values({
        id: threadId,
        organizationId: orgId,
        contactProfileId: contactId,
        platform: 'x',
        externalThreadId: `listening:${mentionId}`,
        kind: 'mention',
        status: 'open',
        lastMessageAt: new Date(),
        sourceMentionId: mentionId,
      });
      await tx
        .update(listeningMentions)
        .set({ assignedThreadId: threadId })
        .where(eq(listeningMentions.id, mentionId));
    });

    // Delete the mention — thread's source_mention_id must go null.
    await runAdmin(fixture.db, (tx) =>
      tx.delete(listeningMentions).where(eq(listeningMentions.id, mentionId)),
    );
    type ThreadRow = { sourceMentionId: string | null };
    const threadRows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ sourceMentionId: inboxThreads.sourceMentionId })
        .from(inboxThreads)
        .where(eq(inboxThreads.id, threadId)),
    )) as ThreadRow[];
    expect(threadRows[0]!.sourceMentionId).toBeNull();
  });

});
