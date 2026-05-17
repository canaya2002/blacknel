'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import {
  connectAdsAccountSchema,
  disconnectAdsAccountSchema,
} from '@/lib/ads/validate';
import { requireUser } from '@/lib/auth/server';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { adsAccounts, auditEvents } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for /ads (Phase 8 / Commit 28).
 *
 *   - `connectAdsAccountAction`    — manual dialog (D-28-3) lets
 *     admin+ create or re-activate a connection. Real OAuth lands
 *     at Phase 11.
 *   - `disconnectAdsAccountAction` — flips `status='disconnected'`.
 *     Spend rows stay (historical reporting). Re-connecting flips
 *     back via the upsert path of `connectAdsAccountAction`.
 *
 * Same audit + gate pattern as the rest of Phase 6-7: `requireUser`
 * + `authorize(role, 'ads:manage')`, mutation under `dbAs`, audit
 * via `dbAdmin`. A failed audit raises INTERNAL_ERROR so audit and
 * state never diverge silently.
 */

export async function connectAdsAccountAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ adsAccountId: string; created: boolean }>> {
  const session = await requireUser();
  authorize(session.role, 'ads:manage');

  const parsed = connectAdsAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de la cuenta de ads inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;
  const brandId = data.brandId ?? null;
  const accountName = data.accountName ?? null;

  // Re-connect path: if a row already exists for (org, platform,
  // external_account_id), flip status back to 'connected' instead
  // of inserting a duplicate (the UNIQUE constraint would block it
  // anyway — we'd rather give a clear "reconnected" outcome).
  const existing = await dbAs<
    Array<{
      id: string;
      status: 'connected' | 'disconnected' | 'error';
      brandId: string | null;
      currency: string;
      accountName: string | null;
    }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        id: adsAccounts.id,
        status: adsAccounts.status,
        brandId: adsAccounts.brandId,
        currency: adsAccounts.currency,
        accountName: adsAccounts.accountName,
      })
      .from(adsAccounts)
      .where(
        and(
          eq(adsAccounts.organizationId, session.orgId),
          eq(adsAccounts.platform, data.platform),
          eq(adsAccounts.externalAccountId, data.externalAccountId),
        ),
      )
      .limit(1),
  );

  if (existing.length > 0) {
    const row = existing[0]!;
    await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
      tx
        .update(adsAccounts)
        .set({
          status: 'connected',
          brandId,
          accountName,
          currency: data.currency,
          connectedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(adsAccounts.id, row.id)),
    );

    try {
      await dbAdmin((tx) =>
        tx.insert(auditEvents).values({
          organizationId: session.orgId,
          userId: session.userId,
          actorType: 'user',
          action: 'ads_account.reconnected',
          entityType: 'ads_account',
          entityId: row.id,
          before: {
            status: row.status,
            brandId: row.brandId,
            currency: row.currency,
            accountName: row.accountName,
          },
          after: {
            status: 'connected',
            brandId,
            currency: data.currency,
            accountName,
          },
          riskLevel: 'low',
        }),
      );
    } catch (cause) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Failed to write ads_account.reconnected audit.',
        { cause, meta: { adsAccountId: row.id } },
      );
    }

    revalidatePath('/ads');
    return ok({ adsAccountId: row.id, created: false });
  }

  // Fresh insert.
  const inserted = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(adsAccounts)
        .values({
          organizationId: session.orgId,
          ...(brandId ? { brandId } : {}),
          platform: data.platform,
          externalAccountId: data.externalAccountId,
          ...(accountName ? { accountName } : {}),
          currency: data.currency,
          status: 'connected',
        })
        .returning({ id: adsAccounts.id }),
  );
  const adsAccountId = inserted[0]?.id;
  if (!adsAccountId) {
    return err('INTERNAL_ERROR', 'No se pudo conectar la cuenta de ads.');
  }

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'ads_account.connected',
        entityType: 'ads_account',
        entityId: adsAccountId,
        after: {
          platform: data.platform,
          externalAccountId: data.externalAccountId,
          currency: data.currency,
          brandId,
          accountName,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write ads_account.connected audit.',
      { cause, meta: { adsAccountId } },
    );
  }

  revalidatePath('/ads');
  return ok({ adsAccountId, created: true });
}

export async function disconnectAdsAccountAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ adsAccountId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'ads:manage');

  const parsed = disconnectAdsAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Solicitud inválida.');
  }
  const { adsAccountId } = parsed.data;

  const prior = await dbAs<
    Array<{ status: 'connected' | 'disconnected' | 'error' }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({ status: adsAccounts.status })
      .from(adsAccounts)
      .where(
        and(
          eq(adsAccounts.id, adsAccountId),
          eq(adsAccounts.organizationId, session.orgId),
        ),
      )
      .limit(1),
  );
  if (prior.length === 0) return err('NOT_FOUND', 'Cuenta de ads no encontrada.');
  if (prior[0]!.status === 'disconnected') {
    return ok({ adsAccountId });
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(adsAccounts)
      .set({ status: 'disconnected', updatedAt: new Date() })
      .where(
        and(
          eq(adsAccounts.id, adsAccountId),
          eq(adsAccounts.organizationId, session.orgId),
        ),
      ),
  );

  try {
    await dbAdmin((tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'ads_account.disconnected',
        entityType: 'ads_account',
        entityId: adsAccountId,
        before: { status: prior[0]!.status },
        after: { status: 'disconnected' },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write ads_account.disconnected audit.',
      { cause, meta: { adsAccountId } },
    );
  }

  revalidatePath('/ads');
  return ok({ adsAccountId });
}
