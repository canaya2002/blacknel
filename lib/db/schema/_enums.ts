import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Single source of truth for enum-typed columns. Postgres enum types live
 * in their own namespace, so changing values later requires a migration —
 * keep them stable.
 */

export const organizationStatusEnum = pgEnum('organization_status', [
  'active',
  'suspended',
  'archived',
]);

export const memberRoleEnum = pgEnum('member_role', [
  'owner',
  'admin',
  'manager',
  'agent',
  'viewer',
]);

export const memberStatusEnum = pgEnum('member_status', [
  'active',
  'invited',
  'suspended',
]);

export const planCodeEnum = pgEnum('plan_code', [
  'standard',
  'growth',
  'enterprise',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active',
  'past_due',
  'canceled',
  'paused',
  'trialing',
]);

export const brandStatusEnum = pgEnum('brand_status', ['active', 'archived']);

export const locationStatusEnum = pgEnum('location_status', ['active', 'archived']);

export const auditActorTypeEnum = pgEnum('audit_actor_type', [
  'user',
  'ai',
  'system',
  'automation',
]);

export const connectedAccountStatusEnum = pgEnum('connected_account_status', [
  'connected',
  'disconnected',
  'expired',
  'error',
]);

export const connectorSyncRunStatusEnum = pgEnum('connector_sync_run_status', [
  'running',
  'success',
  'partial',
  'failed',
]);

export const inboxThreadKindEnum = pgEnum('inbox_thread_kind', [
  'dm',
  'comment',
  'mention',
  'review',
  'whatsapp',
]);

export const inboxThreadStatusEnum = pgEnum('inbox_thread_status', [
  'open',
  'pending',
  'closed',
  'snoozed',
  'spam',
]);

export const inboxThreadPriorityEnum = pgEnum('inbox_thread_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);

export const inboxSentimentEnum = pgEnum('inbox_sentiment', [
  'positive',
  'neutral',
  'negative',
  'unknown',
]);

export const inboxMessageDirectionEnum = pgEnum('inbox_message_direction', [
  'inbound',
  'outbound',
]);

export const inboxMessageAuthorTypeEnum = pgEnum('inbox_message_author_type', [
  'contact',
  'user',
  'ai',
  'system',
]);

export const approvalKindEnum = pgEnum('approval_kind', [
  'inbox_reply',
  'review_response',
  'post',
  'crisis_response',
  'campaign',
]);

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'edited_approved',
  'rejected',
  'expired',
  'escalated',
]);

export const approvalRiskLevelEnum = pgEnum('approval_risk_level', [
  'low',
  'medium',
  'high',
  'critical',
]);

/**
 * Lifecycle of a single review row.
 *
 * Transitions:
 *
 *   pending        → in_progress (someone is drafting / assigned)
 *   in_progress    → responded   (response published)
 *   responded      → archived    (closed and filed)
 *   pending,
 *   in_progress    → spam        (terminal, alternative branch)
 *
 * `archived` is also reachable from `pending` or `in_progress` when an
 * org explicitly closes a review without a public response.
 */
export const reviewStatusEnum = pgEnum('review_status', [
  'pending',
  'in_progress',
  'responded',
  'archived',
  'spam',
]);

/**
 * Lifecycle of a `review_responses` row. Drafts may go through approval
 * the same way inbox replies do — `pending_approval` enters the queue,
 * `approved` is the "approved but not yet dispatched" state, `published`
 * is the terminal success state once the response is actually live on
 * the platform. Phase-4 dispatcher pattern (`lib/approvals/dispatch.ts`)
 * is the model.
 */
export const reviewResponseStatusEnum = pgEnum('review_response_status', [
  'draft',
  'pending_approval',
  'approved',
  'published',
  'rejected',
]);

export const reviewRequestChannelEnum = pgEnum('review_request_channel', [
  'email',
  'sms',
  'whatsapp',
  'qr',
]);

/**
 * Outcome of a review request once the landing form is submitted (or
 * the request expires). `positive_routed` means rating ≥4 sent the
 * user to the public review platform; `negative_captured` means rating
 * ≤3 was kept private + escalated internally.
 */
export const reviewRequestOutcomeEnum = pgEnum('review_request_outcome', [
  'positive_routed',
  'negative_captured',
  'no_response',
  'expired',
]);

/**
 * Lifecycle of a publishing `posts` row.
 *
 * Transitions:
 *
 *   draft               → scheduled              (manager schedules)
 *   draft               → pending_approval       (auto when brand requires_approval)
 *   pending_approval    → scheduled              (approval approved)
 *   pending_approval    → cancelled              (approval rejected)
 *   scheduled           → publishing             (job picks it up at scheduled_at)
 *   scheduled           → cancelled              (user cancels before window)
 *   publishing          → published              (every target succeeded OR mixed)
 *   publishing          → failed                 (every target failed)
 *   draft               → published              (publish-now skips scheduled state)
 *
 * `cancelled` and `published` are terminal. `failed` is terminal for
 * the parent row but individual `post_targets` may retry independently
 * — see `post_target_status`.
 *
 * Phase-6 publish-job (Commit 20) is the only writer that transitions
 * `scheduled → publishing → published|failed`. Earlier transitions go
 * through Server Actions.
 */
export const postStatusEnum = pgEnum('post_status', [
  'draft',
  'pending_approval',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
]);

/**
 * Lifecycle of a single `post_targets` row — one per (post,
 * connected_account). The connector dispatch loop in the publish-job
 * walks these and updates them independently:
 *
 *   pending     → publishing  (job starts the connector.publishPost call)
 *   publishing  → published   (connector returned externalId)
 *   publishing  → failed      (connector threw or exceeded retry budget)
 *
 * The parent `posts.status` rolls up: all published / all failed /
 * mixed → `published` (partial publishing is intentional — the user
 * sees per-target status in the detail view).
 */
export const postTargetStatusEnum = pgEnum('post_target_status', [
  'pending',
  'publishing',
  'published',
  'failed',
]);

/**
 * Marketing-objective taxonomy for `campaigns`. Used for filtering,
 * reports (Phase 8) and the goal column on the campaign card. Not
 * enforced by content type — a campaign with goal `'awareness'` may
 * still hold any kind of post.
 */
export const campaignGoalEnum = pgEnum('campaign_goal', [
  'awareness',
  'engagement',
  'leads',
  'reviews',
  'reputation',
  'event',
  'launch',
  'promotion',
  'education',
  'crisis',
  'seasonal',
  'evergreen',
]);

/**
 * Campaign lifecycle. `draft` is pre-launch; `active` runs between
 * `starts_at` and `ends_at`; `paused` is a manual hold (Phase 9
 * automations can flip this); `completed` is post-end-date;
 * `archived` hides it from the default list. `archived` is the
 * single terminal state — every other state eventually reaches it.
 *
 * # Transition graph (canTransitionCampaignStatus is the canonical gate)
 *
 *     draft     → active   (manager launches the campaign)
 *     draft     → archived (discarded before launch)
 *     active    → paused   (temporary hold)
 *     active    → completed (successful end)
 *     paused    → active   (resumed)
 *     paused    → archived (discarded mid-flight)
 *     completed → archived (closed + filed)
 *
 * # Explicitly disallowed
 *
 *   - `active → draft`     — once launched, no rollback.
 *   - `completed → active` — no re-open. Create a new campaign.
 *   - `archived → *`       — terminal.
 *   - any transition to itself.
 *
 * The matrix lives in `lib/campaigns/validate.ts` as the pure
 * `canTransitionCampaignStatus(from, to)` function. The Server
 * Action `transitionCampaignStatusAction` calls it before issuing
 * the UPDATE so an out-of-graph transition is rejected with
 * `VALIDATION_ERROR`. Tests cover both positive (every allowed
 * edge) and negative (every disallowed edge) cases.
 */
export const campaignStatusEnum = pgEnum('campaign_status', [
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
]);

/**
 * Kinds of asset stored in the content library. `pdf` covers
 * documents only (linked, never embedded in a post). `gif` is split
 * from `image` because some platforms handle GIFs as a separate
 * media type (Twitter/X promotes them via a different endpoint;
 * Instagram converts them to video on upload).
 */
export const contentAssetKindEnum = pgEnum('content_asset_kind', [
  'image',
  'video',
  'pdf',
  'gif',
]);
