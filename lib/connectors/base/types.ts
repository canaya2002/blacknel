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
  // Phase 10 / Commit 38 — Enterprise Networks specifics.
  // Declared by connectors whose API supports each verb.
  'complaint_response', // BBB-specific (resolve / respond to complaint)
  'review_dispute', // Yelp + TripAdvisor — formal dispute filing
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Convenience alias for code that wants to iterate. */
export type CAPABILITIES_LIST = typeof CAPABILITIES;

/**
 * Per-platform limits for the publishing path. Optional — only
 * platforms that declare `publish_post` populate this. The
 * composer (Commit 19) reads from
 * `getConnector(platform).capabilities(account).publishLimits` so
 * each connector is the single source of truth for its own limits.
 *
 * Values reflect the public API limits as of 2026-Q1. Phase 11
 * re-verifies against the real connector SDKs at cutover time
 * (TODO.md#connector-publish-limits-2026).
 */
export interface PublishLimits {
  /** Maximum image attachments per post. Omitted = unlimited. */
  readonly maxImages?: number;
  /** Maximum video attachments per post. */
  readonly maxVideos?: number;
  /**
   * Character cap on the post body. Some platforms also constrain
   * link-card descriptions separately; the composer does NOT
   * enforce those today (handled at Phase 11 with real SDKs).
   */
  readonly maxTextLength?: number;
  /**
   * Media kinds the platform accepts. Filtered against
   * `content_assets.kind` in the composer media picker.
   */
  readonly supportedMediaTypes?: ReadonlyArray<'image' | 'video' | 'gif' | 'pdf'>;
  /**
   * Aspect-ratio whitelist for image / video. Each entry is
   * `"W:H"` (e.g. `"1:1"`, `"4:5"`, `"16:9"`). When omitted, the
   * composer doesn't constrain ratio.
   */
  readonly aspectRatios?: ReadonlyArray<string>;
  /**
   * Premium-tier override flag. When `true`, the connector
   * looks at `account.metadata.premium === true` and applies an
   * alternative limit set encoded inline by the connector. Phase 6
   * only declares the field; consumer logic lives in the composer
   * (Commit 19).
   */
  readonly hasPremiumTier?: boolean;
}

/**
 * Declared capabilities for a connector — what the platform's real API
 * actually allows, expressed as `supported` plus per-capability
 * `notes` (UI tooltips that explain quirks).
 *
 * Example: Yelp does NOT include `reply_reviews` because the Fusion
 * API is read-only. Instagram includes `read_dms` but adds a note
 * about the Messenger inbox limitation. UI consumers render the
 * note next to the capability badge.
 *
 * `publishLimits` is populated by platforms that declare
 * `publish_post`. See `PublishLimits` for the schema.
 */
export interface ConnectorCapabilities {
  readonly supported: ReadonlyArray<Capability>;
  readonly notes?: Partial<Record<Capability, string>>;
  readonly publishLimits?: PublishLimits;
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
