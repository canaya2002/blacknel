import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { connectorSyncRunStatusEnum } from './_enums';
import { connectedAccounts } from './connected-accounts';

/**
 * Append-only log of every sync attempt for a connected account.
 * Powers the detail page's history strip and the dev events ticker.
 *
 * Phase 11 cutover keeps this table identical — Inngest functions
 * write the same rows.
 */
export const connectorSyncRuns = pgTable(
  'connector_sync_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectedAccountId: uuid('connected_account_id')
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    status: connectorSyncRunStatusEnum('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    itemsSynced: integer('items_synced').notNull().default(0),
    errorMessage: text('error_message'),
  },
  (table) => ({
    accountStartedIdx: index('connector_sync_runs_account_started_idx').on(
      table.connectedAccountId,
      table.startedAt,
    ),
  }),
);

export type ConnectorSyncRun = typeof connectorSyncRuns.$inferSelect;
export type NewConnectorSyncRun = typeof connectorSyncRuns.$inferInsert;
