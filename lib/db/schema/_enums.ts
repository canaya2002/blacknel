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
