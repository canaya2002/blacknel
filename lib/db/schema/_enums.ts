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
