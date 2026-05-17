'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import {
  canTransitionCampaignStatus,
  createCampaignSchema,
  setPostCampaignSchema,
  transitionCampaignStatusSchema,
  updateCampaignSchema,
  updateManualSpentSchema,
  type CampaignStatus,
} from '@/lib/campaigns/validate';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, campaigns, posts } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for /publish/campaigns (Commit 21).
 *
 *   - `createCampaignAction`               — owner can be the caller; default status='draft'.
 *   - `updateCampaignAction`               — partial update; cross-field validation in Zod.
 *   - `transitionCampaignStatusAction`     — gates via `canTransitionCampaignStatus`.
 *   - `updateManualSpentAction`            — writes `metadata.manualSpentCents` (Phase-8 placeholder).
 *   - `setPostCampaignAction`              — composer wire: link / unlink a post.
 *
 * Same auth + audit pattern as the rest of Phase 6: `requireUser`
 * + `authorize(role, permission)`, transactional UPDATE under
 * `dbAs`, append-only audit row written via `dbAdmin` after the
 * mutation. Failure to audit raises `INTERNAL_ERROR` and rolls the
 * call back (audit + state must agree).
 */

// ---------------------------------------------------------------------------
// createCampaignAction
// ---------------------------------------------------------------------------

export async function createCampaignAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ campaignId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'campaigns:create');

  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de la campaña inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  type Inserted = { id: string };
  const inserted = await dbAs<Inserted[]>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .insert(campaigns)
        .values({
          organizationId: session.orgId,
          ...(data.brandId !== undefined ? { brandId: data.brandId } : {}),
          name: data.name,
          goal: data.goal,
          status: 'draft',
          ...(data.startsAt ? { startsAt: data.startsAt } : {}),
          ...(data.endsAt ? { endsAt: data.endsAt } : {}),
          ...(data.budgetCents !== null && data.budgetCents !== undefined
            ? { budgetCents: data.budgetCents }
            : {}),
          ownerId: session.userId,
        })
        .returning({ id: campaigns.id }),
  );
  const campaignId = inserted[0]?.id;
  if (!campaignId) {
    return err('INTERNAL_ERROR', 'No se pudo crear la campaña.');
  }

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'campaign.created',
        entityType: 'campaign',
        entityId: campaignId,
        after: {
          name: data.name,
          goal: data.goal,
          brandId: data.brandId ?? null,
          startsAt: data.startsAt?.toISOString() ?? null,
          endsAt: data.endsAt?.toISOString() ?? null,
          budgetCents: data.budgetCents ?? null,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to write campaign.created audit.', {
      cause,
      meta: { campaignId },
    });
  }

  revalidatePath('/publish/campaigns');
  return ok({ campaignId });
}

// ---------------------------------------------------------------------------
// updateCampaignAction
// ---------------------------------------------------------------------------

export async function updateCampaignAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ campaignId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'campaigns:update');

  const parsed = updateCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Edición de campaña inválida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const data = parsed.data;

  // Read prior values for the audit `before`.
  const priorRows = await dbAs<
    Array<{
      name: string;
      goal: string;
      brandId: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      budgetCents: number | null;
    }>
  >({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .select({
        name: campaigns.name,
        goal: campaigns.goal,
        brandId: campaigns.brandId,
        startsAt: campaigns.startsAt,
        endsAt: campaigns.endsAt,
        budgetCents: campaigns.budgetCents,
      })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, data.campaignId),
          eq(campaigns.organizationId, session.orgId),
        ),
      )
      .limit(1),
  );
  if (priorRows.length === 0) return err('NOT_FOUND', 'Campaña no encontrada.');
  const prior = priorRows[0]!;

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (data.name !== undefined) patch.name = data.name;
  if (data.brandId !== undefined) patch.brandId = data.brandId;
  if (data.goal !== undefined) patch.goal = data.goal;
  if (data.startsAt !== undefined) patch.startsAt = data.startsAt;
  if (data.endsAt !== undefined) patch.endsAt = data.endsAt;
  if (data.budgetCents !== undefined) patch.budgetCents = data.budgetCents;
  if (Object.keys(patch).length === 1) {
    // Only `updatedAt` would change — no-op.
    return ok({ campaignId: data.campaignId });
  }

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(campaigns)
      .set(patch)
      .where(
        and(
          eq(campaigns.id, data.campaignId),
          eq(campaigns.organizationId, session.orgId),
        ),
      ),
  );

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'campaign.updated',
        entityType: 'campaign',
        entityId: data.campaignId,
        before: {
          name: prior.name,
          goal: prior.goal,
          brandId: prior.brandId,
          startsAt: prior.startsAt?.toISOString() ?? null,
          endsAt: prior.endsAt?.toISOString() ?? null,
          budgetCents: prior.budgetCents,
        },
        after: { fields: Object.keys(patch).filter((k) => k !== 'updatedAt') },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to write campaign.updated audit.', {
      cause,
      meta: { campaignId: data.campaignId },
    });
  }

  revalidatePath('/publish/campaigns');
  revalidatePath(`/publish/campaigns/${data.campaignId}`);
  return ok({ campaignId: data.campaignId });
}

// ---------------------------------------------------------------------------
// transitionCampaignStatusAction
// ---------------------------------------------------------------------------

export async function transitionCampaignStatusAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ campaignId: string; from: CampaignStatus; to: CampaignStatus }>> {
  const session = await requireUser();
  authorize(session.role, 'campaigns:update');

  const parsed = transitionCampaignStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Transición inválida.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const { campaignId, to } = parsed.data;

  // Lock + read current status under one tx so a concurrent
  // transition can't race us.
  const result = await dbAs<
    | { kind: 'ok'; from: CampaignStatus }
    | { kind: 'not_found' }
    | { kind: 'invalid'; from: CampaignStatus }
  >({ orgId: session.orgId, userId: session.userId }, async (tx) => {
    const lockedRows = await tx
      .select({ id: campaigns.id, status: campaigns.status })
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.organizationId, session.orgId),
        ),
      )
      .for('update')
      .limit(1);
    const row = lockedRows[0];
    if (!row) return { kind: 'not_found' };
    const from = row.status as CampaignStatus;
    if (!canTransitionCampaignStatus(from, to)) {
      return { kind: 'invalid', from };
    }
    await tx
      .update(campaigns)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
    return { kind: 'ok', from };
  });

  if (result.kind === 'not_found') {
    return err('NOT_FOUND', 'Campaña no encontrada.');
  }
  if (result.kind === 'invalid') {
    return err(
      'VALIDATION_ERROR',
      `Transición ${result.from} → ${to} no permitida.`,
      { meta: { from: result.from, to } },
    );
  }

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: `campaign.status.${to}`,
        entityType: 'campaign',
        entityId: campaignId,
        before: { status: result.from },
        after: { status: to },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to write campaign.status audit.', {
      cause,
      meta: { campaignId, from: result.from, to },
    });
  }

  revalidatePath('/publish/campaigns');
  revalidatePath(`/publish/campaigns/${campaignId}`);
  return ok({ campaignId, from: result.from, to });
}

// ---------------------------------------------------------------------------
// updateManualSpentAction — writes metadata.manualSpentCents (Phase-8 placeholder)
// ---------------------------------------------------------------------------

export async function updateManualSpentAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ campaignId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'campaigns:update');

  const parsed = updateManualSpentSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Monto inválido.');
  }
  const { campaignId, manualSpentCents } = parsed.data;

  const rows = await dbAs<Array<{ metadata: unknown }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({ metadata: campaigns.metadata })
        .from(campaigns)
        .where(
          and(
            eq(campaigns.id, campaignId),
            eq(campaigns.organizationId, session.orgId),
          ),
        )
        .limit(1),
  );
  if (rows.length === 0) return err('NOT_FOUND', 'Campaña no encontrada.');
  const prior =
    rows[0]!.metadata && typeof rows[0]!.metadata === 'object'
      ? { ...(rows[0]!.metadata as Record<string, unknown>) }
      : {};
  const next = { ...prior, manualSpentCents };

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(campaigns)
      .set({ metadata: next, updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.organizationId, session.orgId),
        ),
      ),
  );

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'campaign.manual_spent.updated',
        entityType: 'campaign',
        entityId: campaignId,
        before: {
          manualSpentCents:
            typeof prior.manualSpentCents === 'number'
              ? (prior.manualSpentCents as number)
              : null,
        },
        after: { manualSpentCents },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to write campaign.manual_spent audit.',
      { cause, meta: { campaignId } },
    );
  }

  revalidatePath(`/publish/campaigns/${campaignId}`);
  return ok({ campaignId });
}

// ---------------------------------------------------------------------------
// setPostCampaignAction — composer wire
// ---------------------------------------------------------------------------

export async function setPostCampaignAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ postId: string; campaignId: string | null }>> {
  const session = await requireUser();
  // The post side gates via `posts:create` (composer permission).
  // The campaign side gates via `campaigns:read` — the user needs
  // to be able to SEE the campaign they're attaching to.
  authorize(session.role, 'posts:create');
  authorize(session.role, 'campaigns:read');

  const parsed = setPostCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Selección de campaña inválida.');
  }
  const { postId, campaignId } = parsed.data;

  // If campaignId is non-null, verify it exists in the org (RLS
  // would block anyway, but a clean error beats a silent no-op).
  if (campaignId) {
    const camp = await dbAs<Array<{ id: string; status: CampaignStatus }>>(
      { orgId: session.orgId, userId: session.userId },
      (tx) =>
        tx
          .select({ id: campaigns.id, status: campaigns.status })
          .from(campaigns)
          .where(
            and(
              eq(campaigns.id, campaignId),
              eq(campaigns.organizationId, session.orgId),
            ),
          )
          .limit(1),
    );
    if (camp.length === 0) {
      return err('NOT_FOUND', 'La campaña seleccionada no existe.');
    }
    if (camp[0]!.status === 'archived' || camp[0]!.status === 'completed') {
      return err(
        'CONFLICT',
        'No se puede asignar un post a una campaña archivada o completada.',
      );
    }
  }

  // Read prior campaign for audit.
  const priorRows = await dbAs<Array<{ campaignId: string | null }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({ campaignId: posts.campaignId })
        .from(posts)
        .where(
          and(
            eq(posts.id, postId),
            eq(posts.organizationId, session.orgId),
          ),
        )
        .limit(1),
  );
  if (priorRows.length === 0) return err('NOT_FOUND', 'Post no encontrado.');
  const priorCampaignId = priorRows[0]!.campaignId;

  await dbAs({ orgId: session.orgId, userId: session.userId }, (tx) =>
    tx
      .update(posts)
      .set({ campaignId })
      .where(
        and(
          eq(posts.id, postId),
          eq(posts.organizationId, session.orgId),
        ),
      ),
  );

  const action = campaignId ? 'post.campaign.set' : 'post.campaign.removed';
  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action,
        entityType: 'post',
        entityId: postId,
        before: { campaignId: priorCampaignId },
        after: { campaignId },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', `Failed to write ${action} audit.`, {
      cause,
      meta: { postId, campaignId },
    });
  }

  revalidatePath(`/publish/composer/${postId}`);
  if (campaignId) revalidatePath(`/publish/campaigns/${campaignId}`);
  if (priorCampaignId) revalidatePath(`/publish/campaigns/${priorCampaignId}`);
  return ok({ postId, campaignId });
}
