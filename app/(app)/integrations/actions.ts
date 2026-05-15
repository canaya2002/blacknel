'use server';

import { randomBytes } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireUser } from '@/lib/auth/server';
import { getCapabilities } from '@/lib/connectors/registry';
import { PLATFORMS, type PlatformCode } from '@/lib/connectors/base';
import { dbAs } from '@/lib/db/client';
import { connectedAccounts } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { syncAccount } from '@/lib/jobs/sync-account';
import { authorize } from '@/lib/permissions/can';
import { planAllowsPlatform } from '@/lib/plans/gating';
import { getOrgPlanCode } from '@/lib/queries/plan';
import { checkUsage, decrementUsage, incrementUsage } from '@/lib/usage/counters';
import { dbAdmin } from '@/lib/db/client';
import { AppError } from '@/lib/errors';
import { err, ok, type Result } from '@/lib/types/result';

const PLATFORM_VALUES = PLATFORMS.filter((p) => p !== 'mock') as Exclude<PlatformCode, 'mock'>[];

const connectSchema = z.object({
  platform: z.enum(PLATFORM_VALUES as unknown as [PlatformCode, ...PlatformCode[]]),
  brandId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
});

/**
 * Server Actions for /integrations. Connect simulates the OAuth dance
 * with a 2-second delay (the modal stays open meanwhile) and writes a
 * `connected_account` row with the capability snapshot. Disconnect,
 * reconnect, test and sync are thin wrappers that mutate the row and
 * (when meaningful) trigger a sync job.
 */

const FAKE_OAUTH_DELAY_MS = 1500;

function randomExternalId(platform: string): string {
  return `${platform}-${randomBytes(6).toString('base64url')}`;
}

export async function connectAccountAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ accountId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');

  const parsed = connectSchema.safeParse({
    platform: formData.get('platform'),
    brandId: formData.get('brandId') || undefined,
    locationId: formData.get('locationId') || undefined,
  });
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Plataforma inválida.');
  }
  const { platform, brandId, locationId } = parsed.data;

  // Plan + platform gate.
  const planCode = await getOrgPlanCode(session);
  if (!planAllowsPlatform(planCode, platform)) {
    return err('FEATURE_NOT_AVAILABLE_ON_PLAN', `${platform} no está incluida en el plan ${planCode}.`);
  }

  // Plan limit on social accounts.
  const usage = await dbAdmin(async (tx) =>
    checkUsage(tx, session.orgId, planCode, 'socialAccounts', 1),
  );
  if (!usage.ok) {
    return err(
      'PLAN_LIMIT_REACHED',
      `Tu plan permite ${usage.cap} cuentas conectadas y ya tienes ${usage.current}.`,
      { meta: { plan: planCode, cap: usage.cap, current: usage.current } },
    );
  }

  // Fake OAuth: pause and (if `BLACKNEL_MOCK_ERRORS`) maybe fail.
  await new Promise((resolve) => setTimeout(resolve, FAKE_OAUTH_DELAY_MS));
  if (env.BLACKNEL_MOCK_ERRORS && Math.random() < 0.1) {
    return err(
      'INTEGRATION_DISCONNECTED',
      'Permisos insuficientes para esta cuenta. Reintenta y aprueba todos los scopes.',
    );
  }

  const caps = getCapabilities(platform);
  const accountId = await dbAs<{ id: string }[]>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .insert(connectedAccounts)
        .values({
          organizationId: session.orgId,
          ...(brandId ? { brandId } : {}),
          ...(locationId ? { locationId } : {}),
          platform,
          externalAccountId: randomExternalId(platform),
          displayName: defaultDisplayName(platform),
          handle: defaultHandle(platform),
          status: 'connected',
          lastSyncAt: new Date(),
          capabilities: caps.supported,
          oauthTokensEncrypted: {}, // Phase 11: real encrypted tokens
        })
        .returning({ id: connectedAccounts.id }),
  ).then((rows) => rows[0]!.id);

  await dbAdmin(async (tx) => incrementUsage(tx, session.orgId, 'socialAccounts', 1));

  // Fire a first sync best-effort.
  void syncAccount(accountId).catch(() => undefined);

  revalidatePath('/integrations');
  revalidatePath('/dashboard');
  return ok({ accountId });
}

const idSchema = z.object({ accountId: z.string().uuid() });

export async function disconnectAccountAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ accountId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');
  const parsed = idSchema.safeParse({ accountId: formData.get('accountId') });
  if (!parsed.success) return err('VALIDATION_ERROR', 'ID inválido.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .delete(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.id, parsed.data.accountId),
            eq(connectedAccounts.organizationId, session.orgId),
          ),
        ),
  );
  await dbAdmin(async (tx) => decrementUsage(tx, session.orgId, 'socialAccounts', 1));

  revalidatePath('/integrations');
  return ok({ accountId: parsed.data.accountId });
}

export async function reconnectAccountAction(formData: FormData): Promise<void> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');
  const accountId = String(formData.get('accountId') ?? '');
  if (!z.string().uuid().safeParse(accountId).success) {
    throw new AppError('VALIDATION_ERROR', 'ID inválido.');
  }
  await new Promise((resolve) => setTimeout(resolve, FAKE_OAUTH_DELAY_MS / 2));
  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(connectedAccounts)
        .set({
          status: 'connected',
          errorMessage: null,
          lastSyncAt: new Date(),
          oauthTokensEncrypted: {},
        })
        .where(
          and(
            eq(connectedAccounts.id, accountId),
            eq(connectedAccounts.organizationId, session.orgId),
          ),
        ),
  );
  void syncAccount(accountId).catch(() => undefined);
  revalidatePath('/integrations');
  revalidatePath(`/integrations/${accountId}`);
}

export async function syncNowAction(formData: FormData): Promise<void> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');
  const accountId = String(formData.get('accountId') ?? '');
  if (!z.string().uuid().safeParse(accountId).success) {
    throw new AppError('VALIDATION_ERROR', 'ID inválido.');
  }
  // RLS-safe check: the row belongs to this org.
  const exists = await dbAs<Array<{ id: string }>>(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.id, accountId),
            eq(connectedAccounts.organizationId, session.orgId),
          ),
        )
        .limit(1),
  );
  if (exists.length === 0) {
    throw new AppError('NOT_FOUND', 'La cuenta no existe.');
  }
  await syncAccount(accountId);
  revalidatePath(`/integrations/${accountId}`);
}

const reassignSchema = z.object({
  accountId: z.string().uuid(),
  brandId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
});

export async function reassignAccountAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ accountId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'integrations:manage');
  const parsed = reassignSchema.safeParse({
    accountId: formData.get('accountId'),
    brandId: (formData.get('brandId') as string) || null,
    locationId: (formData.get('locationId') as string) || null,
  });
  if (!parsed.success) return err('VALIDATION_ERROR', 'Datos inválidos.');

  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    async (tx) =>
      tx
        .update(connectedAccounts)
        .set({
          brandId: parsed.data.brandId ?? null,
          locationId: parsed.data.locationId ?? null,
        })
        .where(
          and(
            eq(connectedAccounts.id, parsed.data.accountId),
            eq(connectedAccounts.organizationId, session.orgId),
          ),
        ),
  );
  revalidatePath('/integrations');
  revalidatePath(`/integrations/${parsed.data.accountId}`);
  return ok({ accountId: parsed.data.accountId });
}

function defaultDisplayName(platform: PlatformCode): string {
  return `${platform.charAt(0).toUpperCase()}${platform.slice(1)} mock account`;
}

function defaultHandle(platform: PlatformCode): string {
  return `@blacknel-${platform}`;
}

/**
 * Form-action wrapper for direct `<form action={...}>` use. The
 * useActionState-friendly `disconnectAccountAction` takes
 * `(prev, formData)`; this strips the `prev` arg for plain forms.
 */
export async function disconnectAccountFormAction(formData: FormData): Promise<void> {
  await disconnectAccountAction(null, formData);
}
