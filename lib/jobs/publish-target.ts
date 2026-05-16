import 'server-only';

import { and, eq, sql } from 'drizzle-orm';

import { type AnyPgTx, dbAdmin, dbAs } from '@/lib/db/client';
import {
  auditEvents,
  connectedAccounts,
  postTargets,
  posts,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { log } from '@/lib/log';
import { getConnector } from '@/lib/connectors/registry';
import type { ConnectorAccount, PlatformCode } from '@/lib/connectors/base';
import { err, ok, type Result } from '@/lib/types/result';

/**
 * Per-target dispatch for the publish-job (Commit 20a).
 *
 * Contract (one call per `post_target` row):
 *
 *   1. SELECT FOR UPDATE the target row inside the caller's tx.
 *      Concurrent ticks can't pick up the same row twice.
 *   2. Refuse if `idempotency_key` is null — invariant violated.
 *      `createPost` and migration 0009 guarantee non-null at
 *      insert time.
 *   3. Refuse if `target.status` is not in {`pending`, `failed`}
 *      with retry capacity. Already-published / publishing /
 *      permanent-failed rows are skipped silently (returns
 *      `skipped: true`).
 *   4. Stamp `status='publishing'` + audit `post.target.publishing`.
 *   5. Call `connector.publishPost(account, draft, { idempotencyKey })`.
 *   6. On success → `status='published'`, persist `external_post_id`
 *      + `published_at`, audit `post.target.published`.
 *   7. On failure:
 *        - `retry_count += 1`.
 *        - If `retry_count < 3`: `status='failed'`, set
 *          `next_retry_at = now + BACKOFF_MS[retry_count - 1]`,
 *          audit `post.target.failed.transient`.
 *        - If `retry_count >= 3`: `status='failed'`, clear
 *          `next_retry_at`, audit
 *          `post.target.failed.permanent`. Manual retry
 *          (`retryFailedPostAction`) is the only escape.
 *
 * Backoff schedule (D-20-3): 60s → 5min → 15min. Indices
 * 0/1/2 of `BACKOFF_MS`.
 *
 * Idempotency: the connector caches by `(platform, key) →
 * externalId`. A second call with the same key returns the
 * same id without re-throwing the random / forced error gates.
 * That's why a retry of a transient failure is safe.
 */

export const BACKOFF_MS: ReadonlyArray<number> = [60_000, 300_000, 900_000];
export const MAX_RETRY_COUNT = 3;

export interface DispatchOneTargetDeps {
  asUser: <T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: AnyPgTx) => Promise<T>,
  ) => Promise<T>;
  asAdmin: <T>(fn: (tx: AnyPgTx) => Promise<T>) => Promise<T>;
  now: () => Date;
}

const defaultDeps: DispatchOneTargetDeps = {
  asUser: (ctx, fn) => dbAs(ctx, fn),
  asAdmin: (fn) => dbAdmin(fn),
  now: () => new Date(),
};

export interface DispatchOneTargetOpts {
  readonly orgId: string;
  /** Actor identity for the audit trail. Use 'system' for cron path. */
  readonly userId: string;
  /** 'system' for cron ticks, 'user' for synchronous post-approval dispatch. */
  readonly actorType: 'system' | 'user';
  readonly targetId: string;
}

export type DispatchOutcome =
  | { kind: 'published'; externalId: string }
  | { kind: 'failed_transient'; retryCount: number; nextRetryAt: Date; errorMessage: string }
  | { kind: 'failed_permanent'; retryCount: number; errorMessage: string }
  | { kind: 'skipped'; reason: string };

export async function dispatchOneTarget(
  opts: DispatchOneTargetOpts,
  deps: DispatchOneTargetDeps = defaultDeps,
): Promise<Result<DispatchOutcome>> {
  // Three separate reads — `FOR UPDATE` on a 3-table join is
  // brittle in pglite, so we lock only the target row and read
  // the parent post + account via plain admin selects. The post
  // is already locked at the higher level (`processOneCandidate`).
  type TargetRow = {
    targetId: string;
    targetStatus: 'pending' | 'publishing' | 'published' | 'failed';
    retryCount: number;
    idempotencyKey: string | null;
    platformVariant: unknown;
    postId: string;
    connectedAccountId: string;
  };
  // System-level dispatch uses admin context (RLS bypass) — the
  // cron is org-agnostic at the call site, but the org_id WHERE
  // clause still scopes the query to the right tenant.
  const targetRows = await deps.asAdmin<TargetRow[]>((tx) =>
    tx
      .select({
        targetId: postTargets.id,
        targetStatus: postTargets.status,
        retryCount: postTargets.retryCount,
        idempotencyKey: postTargets.idempotencyKey,
        platformVariant: postTargets.platformVariant,
        postId: postTargets.postId,
        connectedAccountId: postTargets.connectedAccountId,
      })
      .from(postTargets)
      .where(
        and(
          eq(postTargets.id, opts.targetId),
          eq(postTargets.organizationId, opts.orgId),
        ),
      )
      .for('update')
      .limit(1),
  );
  const targetRow = targetRows[0];
  if (!targetRow) return err('NOT_FOUND', 'Target no encontrado.');

  type PostRow = { postText: string; postLink: string | null };
  const postRows = await deps.asAdmin<PostRow[]>((tx) =>
    tx
      .select({ postText: posts.text, postLink: posts.link })
      .from(posts)
      .where(eq(posts.id, targetRow.postId))
      .limit(1),
  );
  const postRow = postRows[0];
  if (!postRow) return err('NOT_FOUND', 'Post no encontrado.');

  type AccountRow = {
    accountId: string;
    accountPlatform: string;
    accountBrandId: string | null;
    accountLocationId: string | null;
    accountExternalId: string | null;
    accountDisplayName: string | null;
    accountHandle: string | null;
    accountStatus: 'connected' | 'disconnected' | 'expired' | 'error';
    accountMetadata: unknown;
  };
  const accountRows = await deps.asAdmin<AccountRow[]>((tx) =>
    tx
      .select({
        accountId: connectedAccounts.id,
        accountPlatform: connectedAccounts.platform,
        accountBrandId: connectedAccounts.brandId,
        accountLocationId: connectedAccounts.locationId,
        accountExternalId: connectedAccounts.externalAccountId,
        accountDisplayName: connectedAccounts.displayName,
        accountHandle: connectedAccounts.handle,
        accountStatus: connectedAccounts.status,
        accountMetadata: connectedAccounts.metadata,
      })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, targetRow.connectedAccountId))
      .limit(1),
  );
  const accountRow = accountRows[0];
  if (!accountRow) return err('NOT_FOUND', 'Connected account no encontrada.');

  const row = { ...targetRow, ...postRow, ...accountRow };

  // Status gate: only `pending` or `failed` (transient) targets dispatch.
  if (row.targetStatus === 'published' || row.targetStatus === 'publishing') {
    return ok({ kind: 'skipped', reason: `target.status=${row.targetStatus}` });
  }
  if (row.targetStatus === 'failed' && row.retryCount >= MAX_RETRY_COUNT) {
    return ok({ kind: 'skipped', reason: 'retry_cap_reached' });
  }

  // Invariant: idempotency_key MUST be non-null at dispatch.
  // Migration 0009 backfilled historical rows; new rows get one
  // at insert time. If we see null here, the data layer broke.
  if (!row.idempotencyKey) {
    throw new AppError(
      'INTERNAL_ERROR',
      'post_targets.idempotency_key is null at dispatch time — invariant violated.',
      { meta: { targetId: opts.targetId } },
    );
  }

  // Stamp publishing + audit. Admin context — system-driven
  // mutations bypass RLS so the cron can advance any org's
  // targets without juggling per-tenant sessions.
  await deps.asAdmin((tx) =>
    tx
      .update(postTargets)
      .set({ status: 'publishing' })
      .where(eq(postTargets.id, opts.targetId)),
  );
  await writeAudit(deps, {
    orgId: opts.orgId,
    userId: opts.userId,
    actorType: opts.actorType,
    action: 'post.target.publishing',
    entityType: 'post_target',
    entityId: opts.targetId,
    before: { status: row.targetStatus, retryCount: row.retryCount },
    after: { status: 'publishing' },
  });

  // Build the platform-aware draft from the post body + variant.
  const variant = isObject(row.platformVariant) ? row.platformVariant : {};
  const effectiveText =
    typeof variant.text === 'string' && variant.text.length > 0
      ? variant.text
      : row.postText;
  const effectiveLink =
    typeof variant.link === 'string' && variant.link.length > 0
      ? variant.link
      : row.postLink ?? undefined;

  const account: ConnectorAccount = {
    id: row.accountId,
    organizationId: opts.orgId,
    brandId: row.accountBrandId,
    locationId: row.accountLocationId,
    platform: row.accountPlatform as PlatformCode,
    externalAccountId: row.accountExternalId,
    displayName: row.accountDisplayName,
    handle: row.accountHandle,
    status: row.accountStatus,
    ...(isObject(row.accountMetadata)
      ? { metadata: row.accountMetadata as Record<string, unknown> }
      : {}),
  };

  // Dispatch via the connector registry. Failure → catch path.
  const connector = getConnector(account.platform);
  if (typeof connector.publishPost !== 'function') {
    return err(
      'CAPABILITY_NOT_AVAILABLE',
      `Connector ${account.platform} no soporta publishPost.`,
    );
  }

  try {
    const result = await connector.publishPost(
      account,
      {
        text: effectiveText,
        ...(effectiveLink ? { link: effectiveLink } : {}),
      },
      { idempotencyKey: row.idempotencyKey },
    );

    await deps.asAdmin((tx) =>
      tx
        .update(postTargets)
        .set({
          status: 'published',
          externalPostId: result.externalId,
          publishedAt: deps.now(),
          errorMessage: null,
          nextRetryAt: null,
        })
        .where(eq(postTargets.id, opts.targetId)),
    );
    await writeAudit(deps, {
      orgId: opts.orgId,
      userId: opts.userId,
      actorType: opts.actorType,
      action: 'post.target.published',
      entityType: 'post_target',
      entityId: opts.targetId,
      after: {
        status: 'published',
        externalPostId: result.externalId,
        platform: account.platform,
      },
    });
    return ok({ kind: 'published', externalId: result.externalId });
  } catch (e) {
    const message = (e as Error).message || 'Unknown publish error.';
    const nextRetryCount = row.retryCount + 1;
    const permanent = nextRetryCount >= MAX_RETRY_COUNT;
    const backoffMs = permanent
      ? null
      : (BACKOFF_MS[nextRetryCount - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!);
    const nextRetryAt = permanent || backoffMs === null
      ? null
      : new Date(deps.now().getTime() + backoffMs);

    await deps.asAdmin((tx) =>
      tx
        .update(postTargets)
        .set({
          status: 'failed',
          retryCount: nextRetryCount,
          nextRetryAt,
          errorMessage: message,
        })
        .where(eq(postTargets.id, opts.targetId)),
    );
    await writeAudit(deps, {
      orgId: opts.orgId,
      userId: opts.userId,
      actorType: opts.actorType,
      action: permanent
        ? 'post.target.failed.permanent'
        : 'post.target.failed.transient',
      entityType: 'post_target',
      entityId: opts.targetId,
      after: {
        status: 'failed',
        retryCount: nextRetryCount,
        nextRetryAt: nextRetryAt?.toISOString() ?? null,
        errorMessage: message,
        platform: account.platform,
      },
      riskLevel: permanent ? 'medium' : 'low',
    });

    log.warn(
      {
        targetId: opts.targetId,
        platform: account.platform,
        retryCount: nextRetryCount,
        permanent,
        errorMessage: message,
      },
      'publish.target.failed',
    );

    return ok(
      permanent
        ? {
            kind: 'failed_permanent',
            retryCount: nextRetryCount,
            errorMessage: message,
          }
        : {
            kind: 'failed_transient',
            retryCount: nextRetryCount,
            // `nextRetryAt` is non-null in this branch (permanent is false).
            nextRetryAt: nextRetryAt as Date,
            errorMessage: message,
          },
    );
  }
}

// ---------------------------------------------------------------------------
// Audit helper
// ---------------------------------------------------------------------------

interface AuditInput {
  orgId: string;
  userId: string;
  actorType: 'system' | 'user';
  action: string;
  entityType: 'post' | 'post_target';
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
}

async function writeAudit(
  deps: DispatchOneTargetDeps,
  input: AuditInput,
): Promise<void> {
  try {
    await deps.asAdmin(async (tx) =>
      tx.insert(auditEvents).values({
        organizationId: input.orgId,
        // System actor → userId is null (the cron isn't a real
        // user). User actor → pass through; the FK to users.id
        // matters and the caller passes a real userId.
        userId: input.actorType === 'system' ? null : input.userId,
        actorType: input.actorType,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        ...(input.before !== undefined ? { before: input.before } : {}),
        ...(input.after !== undefined ? { after: input.after } : {}),
        riskLevel: input.riskLevel ?? 'low',
      }),
    );
  } catch (cause) {
    // Audit failures are surfaced but don't roll back the
    // dispatch — the row write already happened, and an audit
    // gap is recoverable (Phase 7 reconcile cron).
    log.error(
      { cause, action: input.action, entityId: input.entityId },
      'publish.target.audit.failed',
    );
  }
  // Touch sql so the import isn't pruned by tree-shaking on
  // future refactors that drop direct sql tags from this file.
  void sql;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
