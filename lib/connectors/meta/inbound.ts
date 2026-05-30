import 'server-only';

import { and, eq } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAsOrg } from '@/lib/db/client';
import {
  connectedAccounts,
  contactProfiles,
  inboxMessages,
  inboxThreads,
  metaWebhookEvents,
} from '@/lib/db/schema';
import { log } from '@/lib/log';

/**
 * Meta inbound webhook processor (C46, P2). Reads a stored `meta_webhook_events`
 * row, normalizes the payload (FB Page feed comments + Messenger messages, IG
 * comments), resolves the owning org via `connected_accounts.external_account_id`,
 * and writes into the existing inbox (contact_profiles + inbox_threads +
 * inbox_messages) UNDER that org's RLS context (`dbAsOrg` — never dbAdmin for the
 * tenant writes). Idempotent: messages dedupe on external id, so reprocessing a
 * Meta retry is a no-op.
 *
 * Coverage is intentionally a solid subset — the full Meta change-event taxonomy
 * is large; unhandled shapes are skipped (the row is still marked processed). See
 * the C46 report for the gap list.
 */

export interface InboundItem {
  readonly platform: 'facebook' | 'instagram';
  /** Page id (FB) or IG business account id — matches connected_accounts. */
  readonly externalAccountId: string;
  readonly kind: 'comment' | 'message' | 'mention';
  readonly externalThreadId: string;
  readonly externalMessageId: string;
  readonly author: { externalId: string; name: string | null };
  readonly body: string;
  readonly sentAt: Date;
}

const THREAD_KIND: Record<InboundItem['kind'], 'comment' | 'dm' | 'mention'> = {
  comment: 'comment',
  message: 'dm',
  mention: 'mention',
};

// --- payload parsing --------------------------------------------------------

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function toDate(v: unknown): Date {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v > 1e12 ? v : v * 1000); // ms vs unix-seconds
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return new Date();
}

/** Normalize a Meta webhook payload into actionable inbound items. */
export function parseMetaWebhook(eventObject: string, payload: unknown): InboundItem[] {
  const root = asObject(payload);
  if (!root) return [];
  const entries = asArray(root.entry);
  const items: InboundItem[] = [];

  for (const entryRaw of entries) {
    const entry = asObject(entryRaw);
    if (!entry) continue;
    const accountId = asString(entry.id);
    if (!accountId) continue;

    if (eventObject === 'page') {
      // FB Page feed comments.
      for (const changeRaw of asArray(entry.changes)) {
        const change = asObject(changeRaw);
        const value = asObject(change?.value);
        if (!value || change?.field !== 'feed' || value.item !== 'comment') continue;
        const from = asObject(value.from);
        const authorId = asString(from?.id);
        const commentId = asString(value.comment_id);
        if (!authorId || !commentId) continue;
        items.push({
          platform: 'facebook',
          externalAccountId: accountId,
          kind: 'comment',
          externalThreadId: asString(value.post_id) ?? commentId,
          externalMessageId: commentId,
          author: { externalId: authorId, name: asString(from?.name) },
          body: asString(value.message) ?? '',
          sentAt: toDate(value.created_time),
        });
      }
      // FB Messenger messages.
      for (const msgRaw of asArray(entry.messaging)) {
        const m = asObject(msgRaw);
        const sender = asObject(m?.sender);
        const message = asObject(m?.message);
        const senderId = asString(sender?.id);
        const mid = asString(message?.mid);
        if (!senderId || !mid) continue;
        items.push({
          platform: 'facebook',
          externalAccountId: accountId,
          kind: 'message',
          externalThreadId: senderId,
          externalMessageId: mid,
          author: { externalId: senderId, name: null },
          body: asString(message?.text) ?? '',
          sentAt: toDate(m?.timestamp),
        });
      }
    } else if (eventObject === 'instagram') {
      // IG comments.
      for (const changeRaw of asArray(entry.changes)) {
        const change = asObject(changeRaw);
        const value = asObject(change?.value);
        if (!value || change?.field !== 'comments') continue;
        const from = asObject(value.from);
        const authorId = asString(from?.id);
        const commentId = asString(value.id);
        const media = asObject(value.media);
        if (!authorId || !commentId) continue;
        items.push({
          platform: 'instagram',
          externalAccountId: accountId,
          kind: 'comment',
          externalThreadId: asString(media?.id) ?? commentId,
          externalMessageId: commentId,
          author: { externalId: authorId, name: asString(from?.username) },
          body: asString(value.text) ?? '',
          sentAt: toDate(value.created_time),
        });
      }
    }
  }
  return items;
}

// --- DB deps seam -----------------------------------------------------------

export interface InboundDeps {
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  orgTx: <T>(orgId: string, fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

function defaultDeps(): InboundDeps {
  return { asAdmin: (fn) => dbAdmin(fn), orgTx: (orgId, fn) => dbAsOrg(orgId, fn) };
}

interface ResolvedAccount {
  id: string;
  organizationId: string;
  brandId: string | null;
  locationId: string | null;
}

async function resolveAccount(
  deps: InboundDeps,
  externalAccountId: string,
  platform: string,
): Promise<ResolvedAccount | null> {
  const rows = await deps.asAdmin<Array<ResolvedAccount>>((tx) =>
    tx
      .select({
        id: connectedAccounts.id,
        organizationId: connectedAccounts.organizationId,
        brandId: connectedAccounts.brandId,
        locationId: connectedAccounts.locationId,
      })
      .from(connectedAccounts)
      .where(
        and(
          eq(connectedAccounts.externalAccountId, externalAccountId),
          eq(connectedAccounts.platform, platform),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

async function upsertContact(
  tx: AnyPgTx,
  orgId: string,
  item: InboundItem,
): Promise<string> {
  const existing = (await tx
    .select({ id: contactProfiles.id })
    .from(contactProfiles)
    .where(
      and(
        eq(contactProfiles.organizationId, orgId),
        eq(contactProfiles.platform, item.platform),
        eq(contactProfiles.externalId, item.author.externalId),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (existing[0]) return existing[0].id;
  const inserted = (await tx
    .insert(contactProfiles)
    .values({
      organizationId: orgId,
      platform: item.platform,
      externalId: item.author.externalId,
      displayName: item.author.name,
    })
    .returning({ id: contactProfiles.id })) as Array<{ id: string }>;
  return inserted[0]!.id;
}

async function upsertThread(
  tx: AnyPgTx,
  account: ResolvedAccount,
  item: InboundItem,
  contactProfileId: string,
): Promise<string> {
  const existing = (await tx
    .select({ id: inboxThreads.id })
    .from(inboxThreads)
    .where(
      and(
        eq(inboxThreads.organizationId, account.organizationId),
        eq(inboxThreads.platform, item.platform),
        eq(inboxThreads.externalThreadId, item.externalThreadId),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (existing[0]) {
    await tx
      .update(inboxThreads)
      .set({ lastMessageAt: item.sentAt, updatedAt: new Date() })
      .where(eq(inboxThreads.id, existing[0].id));
    return existing[0].id;
  }
  const inserted = (await tx
    .insert(inboxThreads)
    .values({
      organizationId: account.organizationId,
      platform: item.platform,
      externalThreadId: item.externalThreadId,
      kind: THREAD_KIND[item.kind],
      connectedAccountId: account.id,
      contactProfileId,
      brandId: account.brandId,
      locationId: account.locationId,
      lastMessageAt: item.sentAt,
    })
    .returning({ id: inboxThreads.id })) as Array<{ id: string }>;
  return inserted[0]!.id;
}

/** Insert the inbound message; idempotent on (thread, external message id). */
async function insertMessage(
  tx: AnyPgTx,
  orgId: string,
  threadId: string,
  item: InboundItem,
): Promise<boolean> {
  const existing = (await tx
    .select({ id: inboxMessages.id })
    .from(inboxMessages)
    .where(
      and(
        eq(inboxMessages.threadId, threadId),
        eq(inboxMessages.externalMessageId, item.externalMessageId),
      ),
    )
    .limit(1)) as Array<{ id: string }>;
  if (existing[0]) return false;
  await tx.insert(inboxMessages).values({
    organizationId: orgId,
    threadId,
    direction: 'inbound',
    authorType: 'contact',
    body: item.body,
    externalMessageId: item.externalMessageId,
    idempotencyKey: item.externalMessageId,
    sentAt: item.sentAt,
  });
  return true;
}

async function markEvent(
  deps: InboundDeps,
  eventId: string,
  status: 'processed' | 'failed',
  reason: string | null,
): Promise<void> {
  await deps.asAdmin((tx) =>
    tx
      .update(metaWebhookEvents)
      .set({ status, failureReason: reason, processedAt: new Date() })
      .where(eq(metaWebhookEvents.id, eventId)),
  );
}

export interface ProcessResult {
  readonly processed: boolean;
  readonly items: number;
  readonly reason?: string;
}

export async function processMetaWebhookEvent(
  data: { webhookEventId: string },
  deps: InboundDeps = defaultDeps(),
): Promise<ProcessResult> {
  const rows = await deps.asAdmin<
    Array<{ id: string; eventObject: string; eventPayload: unknown; status: string }>
  >((tx) =>
    tx
      .select({
        id: metaWebhookEvents.id,
        eventObject: metaWebhookEvents.eventObject,
        eventPayload: metaWebhookEvents.eventPayload,
        status: metaWebhookEvents.status,
      })
      .from(metaWebhookEvents)
      .where(eq(metaWebhookEvents.id, data.webhookEventId))
      .limit(1),
  );
  const ev = rows[0];
  if (!ev) return { processed: false, items: 0, reason: 'event_not_found' };
  if (ev.status === 'processed') return { processed: true, items: 0, reason: 'already_processed' };

  const items = parseMetaWebhook(ev.eventObject, ev.eventPayload);
  if (items.length === 0) {
    await markEvent(deps, ev.id, 'processed', null);
    return { processed: true, items: 0, reason: 'no_actionable_items' };
  }

  let written = 0;
  let anyUnresolved = false;
  for (const item of items) {
    const account = await resolveAccount(deps, item.externalAccountId, item.platform);
    if (!account) {
      anyUnresolved = true;
      continue;
    }
    // Tenant-scoped writes — RLS isolates the job to the resolved org.
    await deps.orgTx(account.organizationId, async (tx) => {
      const contactId = await upsertContact(tx, account.organizationId, item);
      const threadId = await upsertThread(tx, account, item, contactId);
      const inserted = await insertMessage(tx, account.organizationId, threadId, item);
      if (inserted) written += 1;
    });
  }

  // Nothing resolved to a known org → mark failed so it's visible (not silently
  // swallowed). Partial resolution still counts as processed.
  if (anyUnresolved && written === 0) {
    await markEvent(deps, ev.id, 'failed', 'unknown_account');
    log.warn({ eventId: ev.id }, 'meta.inbound.unknown_account');
    return { processed: false, items: 0, reason: 'unknown_account' };
  }

  await markEvent(deps, ev.id, 'processed', null);
  log.info({ eventId: ev.id, items: written }, 'meta.inbound.processed');
  return { processed: true, items: written };
}
