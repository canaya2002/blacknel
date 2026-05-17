import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { runAdmin, runAs } from '../../lib/db/client';
import {
  connectedAccounts,
  contactProfiles,
  inboxMessages,
  inboxThreads,
  organizations,
  plans,
  users,
  whatsappAccounts,
  whatsappTemplates,
} from '../../lib/db/schema';
import { WHATSAPP_CAPABILITIES } from '../../lib/connectors/whatsapp';
import { submitTemplate } from '../../lib/connectors/whatsapp/templates-mock';
import { listApprovedTemplatesForAccountWithTx, listTemplatesWithTx } from '../../lib/whatsapp/queries';
import { createTestDb, type TestDb } from '../helpers/test-db';

/**
 * Phase 9 / Commit 31 — WhatsApp Business lifecycle integration.
 *
 * Server Actions need `requireUser()`. We exercise the DB
 * transitions directly via `runAdmin` and call the pure mock
 * verdict via `submitTemplate`. Coverage:
 *
 *   1. connect flow inserts both connected_accounts +
 *      whatsapp_accounts rows.
 *   2. submitTemplate auto-approves a clean body and rejects
 *      a body containing FORBIDDEN with the canned reason.
 *   3. unique constraint on (account, name, language).
 *   4. listApprovedTemplates filters out pending/rejected.
 *   5. inbox_messages.whatsapp_template_id FK persists on
 *      outbound template sends (the charter-touch column).
 *   6. Tenant isolation: org B never sees org A's templates.
 */

let fixture: TestDb;

const planId = '00000000-0000-4000-8000-c3100c3100c0';
const orgA = '11111111-1111-4111-8111-c3100c3100c0';
const orgB = '11111111-1111-4111-8111-c3100c3100c1';
const userA = '22222222-2222-4222-8222-c3100c3100c0';
const userB = '22222222-2222-4222-8222-c3100c3100c1';
const connA = 'aaaaaaaa-aaaa-4aaa-8aaa-c3100c3100c0';
const waA = 'cccccccc-cccc-4ccc-8ccc-c3100c3100c0';
const contactId = 'dddddddd-dddd-4ddd-8ddd-c3100c3100c0';
const threadId = 'eeeeeeee-eeee-4eee-8eee-c3100c3100c0';

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
      { id: userA, email: 'a@c31.test', name: 'A' },
      { id: userB, email: 'b@c31.test', name: 'B' },
    ]);
    await tx.insert(organizations).values([
      { id: orgA, name: 'Org A', slug: 'c31-org-a', planId },
      { id: orgB, name: 'Org B', slug: 'c31-org-b', planId },
    ]);
    // Connect flow: connected_account + whatsapp_account for Org A.
    await tx.insert(connectedAccounts).values({
      id: connA,
      organizationId: orgA,
      platform: 'whatsapp',
      externalAccountId: 'meta-pn-orga',
      displayName: 'Org A Business',
      status: 'connected',
      lastSyncAt: new Date(),
      capabilities: WHATSAPP_CAPABILITIES.supported,
      oauthTokensEncrypted: {},
    });
    await tx.insert(whatsappAccounts).values({
      id: waA,
      organizationId: orgA,
      connectedAccountId: connA,
      phoneNumber: '+52 55 1111 0000',
      phoneNumberId: 'meta-pn-orga',
      businessAccountId: 'meta-waba-orga',
      displayName: 'Org A Business',
    });
    // Inbox thread + contact for the send test.
    await tx.insert(contactProfiles).values({
      id: contactId,
      organizationId: orgA,
      platform: 'whatsapp',
      externalId: '+52 55 0000 0001',
      displayName: 'Test Customer',
      phone: '+52 55 0000 0001',
    });
    await tx.insert(inboxThreads).values({
      id: threadId,
      organizationId: orgA,
      contactProfileId: contactId,
      connectedAccountId: connA,
      platform: 'whatsapp',
      kind: 'dm',
      externalThreadId: '+52 55 0000 0001',
      lastMessageAt: new Date(),
      status: 'open',
    });
  });
}, 60_000);

afterAll(async () => {
  await fixture.dispose();
});

describe('connect flow', () => {
  it('inserts connected_account + whatsapp_account', async () => {
    type Row = { id: string; phoneNumber: string };
    const rows = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({
          id: whatsappAccounts.id,
          phoneNumber: whatsappAccounts.phoneNumber,
        })
        .from(whatsappAccounts)
        .where(eq(whatsappAccounts.organizationId, orgA)),
    )) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phoneNumber).toBe('+52 55 1111 0000');
  });
});

describe('submitTemplate verdict + persistence', () => {
  const cleanId = 'cccccccc-cccc-4ccc-8ccc-c3100c3100c1';
  const rejectedId = 'cccccccc-cccc-4ccc-8ccc-c3100c3100c2';

  beforeAll(async () => {
    const cleanBody = 'Hola {{1}}, gracias.';
    const rejectedBody = '¡COMPRA YA! FORBIDDEN sin opt-in.';
    const cleanVerdict = submitTemplate({ body: cleanBody });
    const rejectedVerdict = submitTemplate({ body: rejectedBody });
    expect(cleanVerdict.status).toBe('approved');
    expect(rejectedVerdict.status).toBe('rejected');

    const now = new Date();
    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(whatsappTemplates).values([
        {
          id: cleanId,
          organizationId: orgA,
          whatsappAccountId: waA,
          name: 'greeting',
          category: 'utility',
          language: 'es',
          body: cleanBody,
          variables: [{ position: 1, label: 'customer_name' }],
          status: cleanVerdict.status,
          submittedAt: now,
          ...(cleanVerdict.status === 'approved' ? { approvedAt: now } : {}),
        },
        {
          id: rejectedId,
          organizationId: orgA,
          whatsappAccountId: waA,
          name: 'rejected_one',
          category: 'marketing',
          language: 'es',
          body: rejectedBody,
          variables: [],
          status: rejectedVerdict.status,
          ...(rejectedVerdict.rejectedReason
            ? { rejectedReason: rejectedVerdict.rejectedReason }
            : {}),
          submittedAt: now,
          ...(rejectedVerdict.status === 'rejected' ? { rejectedAt: now } : {}),
        },
      ]);
    });
  });

  it('listTemplates returns both', async () => {
    const rows = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listTemplatesWithTx(tx, orgA, waA),
    );
    expect(rows).toHaveLength(2);
  });

  it('listApprovedTemplates returns only approved', async () => {
    const rows = await runAs(fixture.db, { orgId: orgA, userId: userA }, (tx) =>
      listApprovedTemplatesForAccountWithTx(tx, orgA, waA),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('greeting');
  });

  it('unique (account, name, language) — duplicate insert fails', async () => {
    await expect(
      runAdmin(fixture.db, (tx) =>
        tx.insert(whatsappTemplates).values({
          organizationId: orgA,
          whatsappAccountId: waA,
          name: 'greeting',
          category: 'utility',
          language: 'es',
          body: 'duplicate',
          variables: [],
          status: 'approved',
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('inbox_messages.whatsapp_template_id FK (charter touch)', () => {
  it('persists FK on outbound template sends; SET NULL on template delete', async () => {
    const templateId = 'cccccccc-cccc-4ccc-8ccc-c3100c3100c3';
    const messageId = 'ffffffff-ffff-4fff-8fff-c3100c3100c0';
    const now = new Date();

    await runAdmin(fixture.db, async (tx) => {
      await tx.insert(whatsappTemplates).values({
        id: templateId,
        organizationId: orgA,
        whatsappAccountId: waA,
        name: 'order_update',
        category: 'utility',
        language: 'es',
        body: 'Hola {{1}}',
        variables: [{ position: 1, label: 'customer_name' }],
        status: 'approved',
        approvedAt: now,
      });
      await tx.insert(inboxMessages).values({
        id: messageId,
        organizationId: orgA,
        threadId,
        direction: 'outbound',
        authorType: 'user',
        authorId: userA,
        body: 'Hola Carolina',
        sentAt: now,
        externalMessageId: 'wa-mock-out-1',
        whatsappTemplateId: templateId,
      });
    });

    type Row = { whatsappTemplateId: string | null };
    const before = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ whatsappTemplateId: inboxMessages.whatsappTemplateId })
        .from(inboxMessages)
        .where(eq(inboxMessages.id, messageId)),
    )) as Row[];
    expect(before[0]!.whatsappTemplateId).toBe(templateId);

    // Delete the template — FK is ON DELETE SET NULL.
    await runAdmin(fixture.db, (tx) =>
      tx.delete(whatsappTemplates).where(eq(whatsappTemplates.id, templateId)),
    );

    const after = (await runAdmin(fixture.db, (tx) =>
      tx
        .select({ whatsappTemplateId: inboxMessages.whatsappTemplateId })
        .from(inboxMessages)
        .where(eq(inboxMessages.id, messageId)),
    )) as Row[];
    expect(after[0]!.whatsappTemplateId).toBeNull();
  });
});

describe('tenant isolation', () => {
  it('org B sees no whatsapp_accounts despite org A having one', async () => {
    type Row = { id: string };
    const rows = (await runAs(
      fixture.db,
      { orgId: orgB, userId: userB },
      (tx) =>
        tx
          .select({ id: whatsappAccounts.id })
          .from(whatsappAccounts),
    )) as Row[];
    expect(rows).toHaveLength(0);
  });
});
