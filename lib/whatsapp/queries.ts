import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { dbAs, type AnyPgTx } from '@/lib/db/client';
import {
  connectedAccounts,
  whatsappAccounts,
  whatsappTemplates,
  type WhatsappTemplate,
  type WhatsappTemplateStatus,
} from '@/lib/db/schema';

/**
 * Read layer for WhatsApp Business (Phase 9 / Commit 31).
 *
 * Pages: `/integrations/[accountId]` for the templates section,
 * `/inbox/[threadId]` composer (Phase 4) for the template
 * dropdown. RLS enforced — every entry point routes through
 * `dbAs`.
 */

export interface WhatsappAccountRow {
  readonly id: string;
  readonly connectedAccountId: string;
  readonly phoneNumber: string;
  readonly phoneNumberId: string;
  readonly businessAccountId: string;
  readonly displayName: string | null;
  readonly status: 'connected' | 'disconnected' | 'expired' | 'error';
  readonly connectedAt: Date;
}

export async function getWhatsappAccountByConnectedIdWithTx(
  tx: AnyPgTx,
  orgId: string,
  connectedAccountId: string,
): Promise<WhatsappAccountRow | null> {
  type Row = {
    id: string;
    connectedAccountId: string;
    phoneNumber: string;
    phoneNumberId: string;
    businessAccountId: string;
    displayName: string | null;
    status: 'connected' | 'disconnected' | 'expired' | 'error';
    connectedAt: Date;
  };
  const rows: Row[] = await tx
    .select({
      id: whatsappAccounts.id,
      connectedAccountId: whatsappAccounts.connectedAccountId,
      phoneNumber: whatsappAccounts.phoneNumber,
      phoneNumberId: whatsappAccounts.phoneNumberId,
      businessAccountId: whatsappAccounts.businessAccountId,
      displayName: whatsappAccounts.displayName,
      status: connectedAccounts.status,
      connectedAt: connectedAccounts.createdAt,
    })
    .from(whatsappAccounts)
    .innerJoin(
      connectedAccounts,
      eq(connectedAccounts.id, whatsappAccounts.connectedAccountId),
    )
    .where(
      and(
        eq(whatsappAccounts.organizationId, orgId),
        eq(whatsappAccounts.connectedAccountId, connectedAccountId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface WhatsappTemplateRow {
  readonly id: string;
  readonly name: string;
  readonly category: 'utility' | 'marketing' | 'authentication';
  readonly language: string;
  readonly body: string;
  readonly variables: ReadonlyArray<{ position: number; label: string }>;
  readonly status: WhatsappTemplateStatus;
  readonly rejectedReason: string | null;
  readonly approvedAt: Date | null;
  readonly rejectedAt: Date | null;
  readonly createdAt: Date;
}

export async function listTemplatesWithTx(
  tx: AnyPgTx,
  orgId: string,
  whatsappAccountId: string,
): Promise<WhatsappTemplateRow[]> {
  const rows: WhatsappTemplate[] = await tx
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.organizationId, orgId),
        eq(whatsappTemplates.whatsappAccountId, whatsappAccountId),
      ),
    )
    .orderBy(desc(whatsappTemplates.createdAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    language: r.language,
    body: r.body,
    variables: parseVariables(r.variables),
    status: r.status,
    rejectedReason: r.rejectedReason,
    approvedAt: r.approvedAt,
    rejectedAt: r.rejectedAt,
    createdAt: r.createdAt,
  }));
}

/**
 * Approved-only template list for composer dropdown. The
 * composer hides pending/rejected templates because the user
 * can't actually send those.
 */
export async function listApprovedTemplatesForAccountWithTx(
  tx: AnyPgTx,
  orgId: string,
  whatsappAccountId: string,
): Promise<WhatsappTemplateRow[]> {
  const rows: WhatsappTemplate[] = await tx
    .select()
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.organizationId, orgId),
        eq(whatsappTemplates.whatsappAccountId, whatsappAccountId),
        eq(whatsappTemplates.status, 'approved'),
      ),
    )
    .orderBy(desc(whatsappTemplates.approvedAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    language: r.language,
    body: r.body,
    variables: parseVariables(r.variables),
    status: r.status,
    rejectedReason: r.rejectedReason,
    approvedAt: r.approvedAt,
    rejectedAt: r.rejectedAt,
    createdAt: r.createdAt,
  }));
}

export async function listApprovedTemplatesForAccount(ctx: {
  orgId: string;
  userId: string;
  whatsappAccountId: string;
}): Promise<WhatsappTemplateRow[]> {
  return dbAs({ orgId: ctx.orgId, userId: ctx.userId }, (tx) =>
    listApprovedTemplatesForAccountWithTx(tx, ctx.orgId, ctx.whatsappAccountId),
  );
}

function parseVariables(
  raw: unknown,
): ReadonlyArray<{ position: number; label: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ position: number; label: string }> = [];
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const position =
        typeof obj.position === 'number' ? obj.position : null;
      const label = typeof obj.label === 'string' ? obj.label : null;
      if (position !== null && label !== null) {
        out.push({ position, label });
      }
    }
  }
  return out;
}
