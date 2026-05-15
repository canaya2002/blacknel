/**
 * Core connector types. Everything Phase 3+ touches starts here.
 *
 * `PlatformCode` is one of the 16 supported platforms (+ `'mock'` for
 * tests). `Capability` is the verb each platform may or may not let us
 * do; the full set is intentionally narrow so policy decisions can be
 * data-driven everywhere (UI buttons, gating, plan limits, audits).
 */

export const PLATFORMS = [
  'facebook',
  'instagram',
  'gbp',
  'whatsapp',
  'tiktok',
  'linkedin',
  'x',
  'youtube',
  'pinterest',
  'reddit',
  'yelp',
  'tripadvisor',
  'trustpilot',
  'bbb',
  'avvo',
  'mock',
] as const;

export type PlatformCode = (typeof PLATFORMS)[number];

/** Convenience alias for code that wants to iterate. */
export type PLATFORM_CODES = typeof PLATFORMS;

/**
 * 16 capabilities a connector may declare. We split moderation
 * (`delete_*`) from publish/reply, and listening_source from
 * read_mentions so we can address both directions of social listening
 * (Reddit/feed-style sources vs. brand-keyword mentions).
 */
export const CAPABILITIES = [
  'read_comments',
  'reply_comments',
  'delete_comment',
  'read_dms',
  'send_dms',
  'read_mentions',
  'listening_source',
  'publish_post',
  'schedule_post',
  'delete_post',
  'read_insights',
  'read_reviews',
  'reply_reviews',
  'send_review_request',
  'read_ads',
  'pause_ads',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Convenience alias for code that wants to iterate. */
export type CAPABILITIES_LIST = typeof CAPABILITIES;

/**
 * Declared capabilities for a connector — what the platform's real API
 * actually allows, expressed as `supported` plus per-capability
 * `notes` (UI tooltips that explain quirks).
 *
 * Example: Yelp does NOT include `reply_reviews` because the Fusion
 * API is read-only. Instagram includes `read_dms` but adds a note
 * about the Messenger inbox limitation. UI consumers render the
 * note next to the capability badge.
 */
export interface ConnectorCapabilities {
  readonly supported: ReadonlyArray<Capability>;
  readonly notes?: Partial<Record<Capability, string>>;
}

/**
 * Minimal view of a `connected_accounts` row passed to connectors.
 * Mirrors the DB columns the connector needs to do its job without
 * importing the full Drizzle row shape (decouples connector code from
 * the schema module).
 */
export interface ConnectorAccount {
  id: string;
  organizationId: string;
  brandId: string | null;
  locationId: string | null;
  platform: PlatformCode;
  externalAccountId: string | null;
  displayName: string | null;
  handle: string | null;
  status: 'connected' | 'disconnected' | 'expired' | 'error';
  /** Free-form metadata persisted by the connector during sync. */
  metadata?: Record<string, unknown>;
}
