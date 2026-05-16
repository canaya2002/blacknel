import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import {
  approvals,
  auditEvents,
  brands,
  brandVoices,
  campaigns,
  connectedAccounts,
  postTargets,
  posts,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { transitionPostStatus } from '@/lib/publish/posts';
import type { PostStatus } from '@/lib/publish/status-transitions';
import { err, ok, type Result } from '@/lib/types/result';
import type { CampaignGoal } from '@/lib/ai/caption-stub';
import type { PlatformCode } from '@/lib/connectors/base';

import {
  evaluateApprovalRules,
  parseApprovalRules,
  type ApprovalDecision,
} from './approval-rules';

/**
 * Orchestrator that turns the user's "Schedule / Publish now" click
 * into the right end state for the post (Commit 19c.3).
 *
 * Order of operations:
 *
 *   1. Read `posts.scheduled_at` (defense vs client tampering).
 *   2. Read `brand_voices.metadata.approvalRules` for the brand
 *      (post → brand → brandVoice → metadata).
 *   3. Read target platforms from `post_targets`.
 *   4. Read `campaign.goal` if the post has a campaign.
 *   5. Evaluate approval rules.
 *   6. Branch:
 *        - rules require approval → insert `approvals` row +
 *          transition `pending_approval` + audit
 *          `post.routed_to_approval`.
 *        - rules don't require approval AND `scheduled_at` null →
 *          transition `published` + audit `post.published_immediate`.
 *        - rules don't require approval AND `scheduled_at` non-null
 *          → transition `scheduled` + audit `post.scheduled`.
 *
 * DI seam (`ApplyScheduleDeps`) mirrors `new-draft.ts` /
 * `set-targets.ts` / `uploadAndRecord` so integration tests can
 * exercise every branch under the fixture pglite.
 */

export interface ApplyScheduleDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
}

const defaultDeps: ApplyScheduleDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
};

export interface ApplyScheduleOpts {
  readonly orgId: string;
  readonly userId: string;
  readonly postId: string;
}

export interface ApplyScheduleSuccess {
  readonly postId: string;
  readonly from: PostStatus;
  readonly to: PostStatus;
  readonly routedToApproval: boolean;
  readonly approvalId: string | null;
  readonly approvalDecision: ApprovalDecision;
}

/**
 * Reads context for the post in a single dbAs pass. Returns null
 * when the post doesn't exist or is invisible to the session.
 */
async function loadContext(
  deps: ApplyScheduleDeps,
  ctx: { orgId: string; userId: string },
  postId: string,
): Promise<
  | {
      scheduledAt: Date | null;
      status: PostStatus;
      brandId: string | null;
      brandVoiceMetadata: unknown;
      campaignGoal: CampaignGoal | null;
      targetPlatforms: ReadonlyArray<PlatformCode>;
    }
  | null
> {
  return deps.asUser(ctx, async (tx) => {
    type Row = {
      scheduledAt: Date | null;
      status: PostStatus;
      brandId: string | null;
      brandVoiceMetadata: unknown;
      campaignGoal: string | null;
    };
    const headerRows = (await tx
      .select({
        scheduledAt: posts.scheduledAt,
        status: posts.status,
        brandId: posts.brandId,
        brandVoiceMetadata: brandVoices.metadata,
        campaignGoal: campaigns.goal,
      })
      .from(posts)
      .leftJoin(brands, eq(brands.id, posts.brandId))
      .leftJoin(brandVoices, eq(brandVoices.id, brands.brandVoiceId))
      .leftJoin(campaigns, eq(campaigns.id, posts.campaignId))
      .where(and(eq(posts.id, postId), eq(posts.organizationId, ctx.orgId)))
      .limit(1)) as Row[];
    const header = headerRows[0];
    if (!header) return null;

    type TargetRow = { platform: string };
    const targetRows = (await tx
      .select({ platform: connectedAccounts.platform })
      .from(postTargets)
      .innerJoin(
        connectedAccounts,
        eq(connectedAccounts.id, postTargets.connectedAccountId),
      )
      .where(
        and(
          eq(postTargets.postId, postId),
          // Defense-in-depth org match; RLS already gates this read.
          eq(postTargets.organizationId, ctx.orgId),
          inArray(postTargets.status, ['pending', 'publishing', 'published']),
        ),
      )) as TargetRow[];

    const platforms = Array.from(
      new Set(targetRows.map((r) => r.platform as PlatformCode)),
    );

    return {
      scheduledAt: header.scheduledAt,
      status: header.status,
      brandId: header.brandId,
      brandVoiceMetadata: header.brandVoiceMetadata,
      campaignGoal: (header.campaignGoal as CampaignGoal | null) ?? null,
      targetPlatforms: platforms,
    };
  });
}

export async function applySchedule(
  opts: ApplyScheduleOpts,
  deps: ApplyScheduleDeps = defaultDeps,
): Promise<Result<ApplyScheduleSuccess>> {
  const context = await loadContext(
    deps,
    { orgId: opts.orgId, userId: opts.userId },
    opts.postId,
  );
  if (!context) return err('NOT_FOUND', 'Post no encontrado.');
  if (context.status !== 'draft' && context.status !== 'pending_approval') {
    return err(
      'CONFLICT',
      `No se puede programar un post en estado ${context.status}.`,
    );
  }

  const rules = parseApprovalRules(context.brandVoiceMetadata);
  const decision = evaluateApprovalRules({
    rules,
    targetPlatforms: context.targetPlatforms,
    campaignGoal: context.campaignGoal,
  });

  // ----- Branch 1: approval required ----------------------------------
  if (decision.required) {
    let approvalId: string;
    try {
      const inserted = await deps.asUser<Array<{ id: string }>>(
        { orgId: opts.orgId, userId: opts.userId },
        (tx) =>
          tx
            .insert(approvals)
            .values({
              organizationId: opts.orgId,
              kind: 'post',
              entityTable: 'posts',
              entityId: opts.postId,
              requestedBy: opts.userId,
              status: 'pending',
              riskLevel: 'low',
              proposedPayload: {
                kind: 'post',
                postId: opts.postId,
                scheduledAtIso: context.scheduledAt?.toISOString() ?? null,
                targetPlatforms: context.targetPlatforms,
                ...(context.campaignGoal
                  ? { campaignGoal: context.campaignGoal }
                  : {}),
                approvalReason: decision.reason,
                ...(decision.matchedPlatforms.length > 0
                  ? { matchedPlatforms: decision.matchedPlatforms }
                  : {}),
                ...(decision.matchedCampaignGoal
                  ? { matchedCampaignGoal: decision.matchedCampaignGoal }
                  : {}),
              },
            })
            .returning({ id: approvals.id }),
      );
      approvalId = inserted[0]!.id;
    } catch (cause) {
      throw new AppError('INTERNAL_ERROR', 'Failed to insert approval row.', {
        cause,
        meta: { postId: opts.postId },
      });
    }

    const result = await transitionPostStatus(
      { orgId: opts.orgId, userId: opts.userId },
      opts.postId,
      'pending_approval',
      { asUser: deps.asUser, asAdmin: deps.asAdmin, now: () => new Date() },
    );
    if (!result.ok) return result;

    try {
      await deps.asAdmin(async (tx) =>
        tx.insert(auditEvents).values({
          organizationId: opts.orgId,
          userId: opts.userId,
          actorType: 'user',
          action: 'post.routed_to_approval',
          entityType: 'post',
          entityId: opts.postId,
          after: {
            reason: decision.reason,
            approvalId,
            ...(decision.matchedPlatforms.length > 0
              ? { matchedPlatforms: decision.matchedPlatforms }
              : {}),
            ...(decision.matchedCampaignGoal
              ? { matchedCampaignGoal: decision.matchedCampaignGoal }
              : {}),
          },
          riskLevel: 'medium',
        }),
      );
    } catch (cause) {
      throw new AppError(
        'INTERNAL_ERROR',
        'Failed to write post.routed_to_approval audit row.',
        { cause, meta: { postId: opts.postId, approvalId } },
      );
    }

    return ok({
      postId: opts.postId,
      from: result.data.from,
      to: result.data.to,
      routedToApproval: true,
      approvalId,
      approvalDecision: decision,
    });
  }

  // ----- Branch 2 & 3: direct transition ------------------------------
  const to: PostStatus = context.scheduledAt === null ? 'published' : 'scheduled';
  const result = await transitionPostStatus(
    { orgId: opts.orgId, userId: opts.userId },
    opts.postId,
    to,
    { asUser: deps.asUser, asAdmin: deps.asAdmin, now: () => new Date() },
  );
  if (!result.ok) return result;

  const auditAction =
    to === 'published' ? 'post.published_immediate' : 'post.scheduled';
  try {
    await deps.asAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: opts.orgId,
        userId: opts.userId,
        actorType: 'user',
        action: auditAction,
        entityType: 'post',
        entityId: opts.postId,
        after: { scheduledAt: context.scheduledAt?.toISOString() ?? null },
        riskLevel: 'low',
      }),
    );
  } catch (cause) {
    throw new AppError(
      'INTERNAL_ERROR',
      `Failed to write ${auditAction} audit row.`,
      { cause, meta: { postId: opts.postId } },
    );
  }

  return ok({
    postId: opts.postId,
    from: result.data.from,
    to: result.data.to,
    routedToApproval: false,
    approvalId: null,
    approvalDecision: decision,
  });
}
