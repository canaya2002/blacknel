/**
 * Single re-export hub for the Drizzle schema. Used everywhere we need
 * tables in queries; never import individual schema files from app code.
 *
 *   import { brands, organizations } from '@/lib/db/schema';
 *
 * The Drizzle client is also constructed with this module so all tables
 * are discoverable on `db.query.*`.
 */

export * from './_enums';
export * from './plans';
export * from './users';
export * from './organizations';
export * from './organization-members';
export * from './invitations';
export * from './brand-voices';
export * from './brands';
export * from './locations';
export * from './subscriptions';
export * from './usage-counters';
export * from './audit-events';
export * from './connected-accounts';
export * from './connector-sync-runs';
