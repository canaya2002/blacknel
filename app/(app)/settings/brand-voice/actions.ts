'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth/server';
import { diffApprovalRules } from '@/lib/brand-voice/diff';
import {
  createBrandVoiceSchema,
  normalizeEmojis,
  normalizeWords,
  updateBrandVoiceSchema,
  type ApprovalRules,
} from '@/lib/brand-voice/validate';
import { dbAdmin, dbAs } from '@/lib/db/client';
import { auditEvents, brandVoices, brands } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { authorize } from '@/lib/permissions/can';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Server Actions for the /settings/brand-voice editor
 * (Commit 26).
 *
 *   - `createBrandVoiceAction` — INSERT brand_voice + LINK
 *      `brands.brand_voice_id`. Audit `brand_voice.created`.
 *   - `updateBrandVoiceAction` — UPDATE brand_voice in place.
 *      Two audit rows when the diff is non-trivial:
 *        - `brand_voice.updated` (top-level fields delta)
 *        - `brand_voice.approval_rules.changed` (the granular
 *          approval-rules diff per Ajuste 2). Skipped when the
 *          approval-rules section didn't change.
 *
 * **Last-write-wins concurrency (D-26-2).** Both actions issue
 * straightforward UPDATEs without SELECT FOR UPDATE or
 * optimistic locking via `updated_at`. Brand voice edits are
 * rare + manager-gated; a Phase-12 polish entry tracks the
 * optimistic-locking refinement.
 */

export async function createBrandVoiceAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ brandVoiceId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'brand_voice:manage');

  const parsed = createBrandVoiceSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de la voz de marca inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const { brandId, form } = parsed.data;

  // Verify the brand belongs to this org. RLS would bounce a
  // mismatch but the explicit check returns a clean error.
  const brandRows = await dbAs<Array<{ id: string; brandVoiceId: string | null }>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({ id: brands.id, brandVoiceId: brands.brandVoiceId })
        .from(brands)
        .where(
          and(eq(brands.id, brandId), eq(brands.organizationId, session.orgId)),
        )
        .limit(1),
  );
  const brand = brandRows[0];
  if (!brand) return err('NOT_FOUND', 'Marca no encontrada.');
  if (brand.brandVoiceId) {
    return err(
      'CONFLICT',
      'Esta marca ya tiene una voz asignada. Edítala en su lugar.',
      { meta: { brandVoiceId: brand.brandVoiceId } },
    );
  }

  const normalized = {
    name: form.name,
    tone: form.tone,
    style: form.style,
    forbiddenWords: normalizeWords(form.forbiddenWords),
    preferredWords: normalizeWords(form.preferredWords),
    allowedEmojis: normalizeEmojis(form.allowedEmojis),
    languages: form.languages,
    approvalRules: form.approvalRules,
  };

  let brandVoiceId: string;
  try {
    brandVoiceId = await dbAs<string>(
      { orgId: session.orgId, userId: session.userId },
      async (tx) => {
        const inserted = await tx
          .insert(brandVoices)
          .values({
            organizationId: session.orgId,
            name: normalized.name,
            tone: normalized.tone,
            style: normalized.style,
            forbiddenWords: normalized.forbiddenWords as string[],
            preferredWords: normalized.preferredWords as string[],
            allowedEmojis: normalized.allowedEmojis as string[],
            languages: normalized.languages as string[],
            metadata: { approvalRules: normalized.approvalRules },
          })
          .returning({ id: brandVoices.id });
        const id = inserted[0]!.id;
        await tx
          .update(brands)
          .set({ brandVoiceId: id })
          .where(eq(brands.id, brandId));
        return id;
      },
    );
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Failed to create brand voice.', {
      cause,
      meta: { brandId },
    });
  }

  try {
    await dbAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: session.orgId,
        userId: session.userId,
        actorType: 'user',
        action: 'brand_voice.created',
        entityType: 'brand_voice',
        entityId: brandVoiceId,
        after: {
          brandId,
          name: normalized.name,
          languages: normalized.languages,
          approvalRules: normalized.approvalRules,
        },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      'Failed to audit brand_voice.created.',
      { cause, meta: { brandVoiceId } },
    );
  }

  revalidatePath('/settings/brand-voice');
  return ok({ brandVoiceId });
}

export async function updateBrandVoiceAction(
  _prev: unknown,
  input: unknown,
): Promise<Result<{ brandVoiceId: string }>> {
  const session = await requireUser();
  authorize(session.role, 'brand_voice:manage');

  const parsed = updateBrandVoiceSchema.safeParse(input);
  if (!parsed.success) {
    return err('VALIDATION_ERROR', 'Datos de la voz de marca inválidos.', {
      meta: { issues: parsed.error.flatten() },
    });
  }
  const { brandVoiceId, form } = parsed.data;

  // Read prior state for the diff.
  type PriorRow = {
    name: string;
    tone: string | null;
    style: string | null;
    allowedEmojis: unknown;
    forbiddenWords: unknown;
    preferredWords: unknown;
    languages: unknown;
    metadata: unknown;
  };
  const priorRows = await dbAs<Array<PriorRow>>(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .select({
          name: brandVoices.name,
          tone: brandVoices.tone,
          style: brandVoices.style,
          allowedEmojis: brandVoices.allowedEmojis,
          forbiddenWords: brandVoices.forbiddenWords,
          preferredWords: brandVoices.preferredWords,
          languages: brandVoices.languages,
          metadata: brandVoices.metadata,
        })
        .from(brandVoices)
        .where(
          and(
            eq(brandVoices.id, brandVoiceId),
            eq(brandVoices.organizationId, session.orgId),
          ),
        )
        .limit(1),
  );
  if (priorRows.length === 0) {
    return err('NOT_FOUND', 'Voz de marca no encontrada.');
  }
  const prior = priorRows[0]!;
  const priorRules = extractApprovalRules(prior.metadata);

  const normalized = {
    name: form.name,
    tone: form.tone,
    style: form.style,
    forbiddenWords: normalizeWords(form.forbiddenWords),
    preferredWords: normalizeWords(form.preferredWords),
    allowedEmojis: normalizeEmojis(form.allowedEmojis),
    languages: form.languages,
    approvalRules: form.approvalRules,
  };

  // Persist. Last-write-wins (D-26-2) — no row lock, no
  // updated_at check.
  await dbAs(
    { orgId: session.orgId, userId: session.userId },
    (tx) =>
      tx
        .update(brandVoices)
        .set({
          name: normalized.name,
          tone: normalized.tone,
          style: normalized.style,
          forbiddenWords: normalized.forbiddenWords as string[],
          preferredWords: normalized.preferredWords as string[],
          allowedEmojis: normalized.allowedEmojis as string[],
          languages: normalized.languages as string[],
          metadata: {
            ...(prior.metadata as Record<string, unknown> | null ?? {}),
            approvalRules: normalized.approvalRules,
          },
          updatedAt: new Date(),
        })
        .where(eq(brandVoices.id, brandVoiceId)),
  );

  // Audit 1 — generic "updated" with which fields changed.
  const fieldChanges = computeFieldChanges(prior, normalized);
  if (fieldChanges.length > 0) {
    try {
      await dbAdmin(async (tx) =>
        tx.insert(auditEvents).values({
          organizationId: session.orgId,
          userId: session.userId,
          actorType: 'user',
          action: 'brand_voice.updated',
          entityType: 'brand_voice',
          entityId: brandVoiceId,
          after: { fieldsChanged: fieldChanges },
          riskLevel: 'low',
        }),
      );
    } catch (cause) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Failed to audit brand_voice.updated.',
        { cause, meta: { brandVoiceId } },
      );
    }
  }

  // Audit 2 — granular approval-rules diff (Ajuste 2). Only
  // emitted when the diff is non-trivial; `diffApprovalRules`
  // returns `null` when nothing changed.
  const rulesDiff = diffApprovalRules(priorRules, normalized.approvalRules);
  if (rulesDiff !== null) {
    try {
      await dbAdmin(async (tx) =>
        tx.insert(auditEvents).values({
          organizationId: session.orgId,
          userId: session.userId,
          actorType: 'user',
          action: 'brand_voice.approval_rules.changed',
          entityType: 'brand_voice',
          entityId: brandVoiceId,
          before: priorRules as unknown as Record<string, unknown>,
          after: normalized.approvalRules as unknown as Record<string, unknown>,
          // The diff itself lands inside `after` so a flat
          // dashboard query that selects `after` shows the
          // delta directly.
          riskLevel: rulesDiff.requireApprovalForPostsChanged?.to ? 'medium' : 'low',
        }),
      );
      // Patch the audit row with the diff via a second-write so
      // the JSON merges cleanly — the audit_events table
      // doesn't have a dedicated diff column today.
      await dbAdmin(async (tx) =>
        tx
          .update(auditEvents)
          .set({
            after: {
              ...(normalized.approvalRules as unknown as Record<string, unknown>),
              diff: rulesDiff as unknown as Record<string, unknown>,
            },
          })
          .where(
            and(
              eq(auditEvents.entityId, brandVoiceId),
              eq(auditEvents.action, 'brand_voice.approval_rules.changed'),
            ),
          ),
      );
    } catch (cause) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Failed to audit brand_voice.approval_rules.changed.',
        { cause, meta: { brandVoiceId } },
      );
    }
  }

  revalidatePath('/settings/brand-voice');
  revalidatePath(`/settings/brand-voice/${brandVoiceId}/edit`);
  return ok({ brandVoiceId });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractApprovalRules(metadata: unknown): ApprovalRules {
  if (metadata && typeof metadata === 'object') {
    const m = metadata as Record<string, unknown>;
    const rules = m.approvalRules;
    if (rules && typeof rules === 'object') {
      const r = rules as Record<string, unknown>;
      return {
        requireApprovalForPosts: r.requireApprovalForPosts === true,
        requireApprovalForPostsOnPlatforms: Array.isArray(
          r.requireApprovalForPostsOnPlatforms,
        )
          ? (r.requireApprovalForPostsOnPlatforms.filter(
              (v): v is string => typeof v === 'string',
            ) as Array<ApprovalRules['requireApprovalForPostsOnPlatforms'][number]>)
          : [],
        requireApprovalForCampaignTypes: Array.isArray(
          r.requireApprovalForCampaignTypes,
        )
          ? (r.requireApprovalForCampaignTypes.filter(
              (v): v is string => typeof v === 'string',
            ) as Array<ApprovalRules['requireApprovalForCampaignTypes'][number]>)
          : [],
      };
    }
  }
  return {
    requireApprovalForPosts: false,
    requireApprovalForPostsOnPlatforms: [],
    requireApprovalForCampaignTypes: [],
  };
}

interface NormalizedForm {
  name: string;
  tone: string;
  style: string;
  forbiddenWords: ReadonlyArray<string>;
  preferredWords: ReadonlyArray<string>;
  allowedEmojis: ReadonlyArray<string>;
  languages: ReadonlyArray<string>;
}

function computeFieldChanges(
  prior: {
    name: string;
    tone: string | null;
    style: string | null;
    forbiddenWords: unknown;
    preferredWords: unknown;
    allowedEmojis: unknown;
    languages: unknown;
  },
  next: NormalizedForm,
): string[] {
  const changes: string[] = [];
  if (prior.name !== next.name) changes.push('name');
  if ((prior.tone ?? '') !== next.tone) changes.push('tone');
  if ((prior.style ?? '') !== next.style) changes.push('style');
  if (!arrayEq(prior.forbiddenWords, next.forbiddenWords))
    changes.push('forbiddenWords');
  if (!arrayEq(prior.preferredWords, next.preferredWords))
    changes.push('preferredWords');
  if (!arrayEq(prior.allowedEmojis, next.allowedEmojis))
    changes.push('allowedEmojis');
  if (!arrayEq(prior.languages, next.languages)) changes.push('languages');
  return changes;
}

function arrayEq(prior: unknown, next: ReadonlyArray<string>): boolean {
  const priorArr = Array.isArray(prior) ? (prior as unknown[]) : [];
  if (priorArr.length !== next.length) return false;
  const a = [...priorArr].map(String).sort();
  const b = [...next].sort();
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
