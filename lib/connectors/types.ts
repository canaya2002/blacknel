/**
 * Platform identifiers shared across Blacknel. Used by:
 *
 *   - `lib/plans/plans.ts` to declare which platforms a plan exposes.
 *   - `lib/connectors/` (Phase 3) to register a Connector implementation
 *     per platform.
 *   - UI gates that hide buttons whose platform isn't available.
 *
 * Adding a new platform is a one-line change here; Phase 3 then ships
 * a Connector that satisfies the capability flags. The plan-feature
 * `networks` array uses these codes verbatim.
 */
export type PlatformCode =
  | 'facebook'
  | 'instagram'
  | 'gbp'
  | 'whatsapp'
  | 'tiktok'
  | 'linkedin'
  | 'x'
  | 'youtube'
  | 'pinterest'
  | 'reddit'
  | 'yelp'
  | 'tripadvisor'
  | 'trustpilot'
  | 'bbb'
  | 'avvo'
  | 'mock';

/**
 * Capabilities Phase 3 connectors declare per account. Defined here so
 * `lib/plans/gating.ts` can reason about them without depending on the
 * full connector machinery before it lands.
 */
export type Capability =
  | 'read_comments'
  | 'reply_comments'
  | 'read_dms'
  | 'send_dms'
  | 'read_mentions'
  | 'publish_post'
  | 'schedule_post'
  | 'delete_post'
  | 'read_insights'
  | 'read_reviews'
  | 'reply_reviews'
  | 'read_ads'
  | 'pause_ads'
  | 'send_review_request';
