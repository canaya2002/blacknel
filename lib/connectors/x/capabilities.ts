import type { ConnectorCapabilities } from '../base';

/**
 * X (Twitter) API v2 publish limits as of 2026-Q1, sourced from
 * developer.x.com/en/docs/x-api. Re-verify in Phase 11 — see
 * TODO.md#connector-publish-limits-2026.
 *
 * `maxTextLength: 280` is the Free-tier default; X Premium
 * accounts unlock 25,000 chars. The composer (Commit 19) reads
 * `account.metadata.premium` to switch — `hasPremiumTier: true`
 * signals that this capability supports that override.
 */
export const X_CAPABILITIES: ConnectorCapabilities = {
  supported: ['publish_post', 'schedule_post', 'read_dms', 'send_dms', 'read_mentions'],
  notes: {
    read_dms:
      'X API v2 expone DMs solo en planes Basic+; cuentas Free están limitadas a lectura limitada.',
    publish_post:
      'Free tier: 280 chars. Premium / Premium+ desbloquea posts largos (25,000 chars). Composer lee account.metadata.premium.',
  },
  publishLimits: {
    maxImages: 4,
    maxVideos: 1,
    maxTextLength: 280,
    supportedMediaTypes: ['image', 'video', 'gif'],
    hasPremiumTier: true,
  },
};
