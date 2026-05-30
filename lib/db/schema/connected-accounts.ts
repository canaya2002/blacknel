import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { connectedAccountStatusEnum } from './_enums';
import { brands } from './brands';
import { locations } from './locations';
import { organizations } from './organizations';

/**
 * A platform account linked to an org. `platform` is a free-form text
 * column intentionally: the connector registry validates it at runtime
 * against `PlatformCode`. We avoid binding the DB to that enum so
 * adding / retiring a platform doesn't require a schema migration.
 *
 * `capabilities` mirrors `ConnectorCapabilities.supported` at the
 * moment of connection. The connector's runtime capability check is
 * canonical, but having the snapshot in the DB lets UI render badges
 * without invoking the connector on every render.
 *
 * `oauth_tokens_encrypted` is an opaque jsonb blob today (empty in
 * mock mode). Phase 11 cutover replaces the contents with real
 * encrypted tokens — the column shape stays.
 */
export const connectedAccounts = pgTable(
  'connected_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    platform: text('platform').notNull(),
    externalAccountId: text('external_account_id'),
    displayName: text('display_name'),
    handle: text('handle'),
    status: connectedAccountStatusEnum('status').notNull().default('connected'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    /** Frozen `ConnectorCapabilities.supported` array at connect time. */
    capabilities: jsonb('capabilities').notNull().default(sql`'[]'::jsonb`),
    /**
     * OAuth tokens (C46) — AES-256-GCM envelope { v, alg, iv, ct, tag } written
     * by lib/connectors/tokens.ts. Empty `{}` in mock mode / before connect.
     */
    oauthTokensEncrypted: jsonb('oauth_tokens_encrypted').notNull().default(sql`'{}'::jsonb`),
    /**
     * Plaintext mirror of the token expiry (C46) so the refresh cron can find
     * soon-to-expire connections without decrypting. Null = non-expiring / none.
     */
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgPlatformExternalUnique: uniqueIndex('connected_accounts_org_platform_external_unique').on(
      table.organizationId,
      table.platform,
      table.externalAccountId,
    ),
    orgStatusIdx: index('connected_accounts_org_status_idx').on(
      table.organizationId,
      table.status,
    ),
    brandIdx: index('connected_accounts_brand_idx').on(table.brandId),
  }),
);

export type ConnectedAccount = typeof connectedAccounts.$inferSelect;
export type NewConnectedAccount = typeof connectedAccounts.$inferInsert;
