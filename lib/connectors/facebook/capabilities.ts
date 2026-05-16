import type { ConnectorCapabilities } from '../base';

/**
 * Facebook Pages publish limits as of 2026-Q1, sourced from
 * developers.facebook.com/docs/pages-api. Re-verify in Phase 11 —
 * see TODO.md#connector-publish-limits-2026.
 */
export const FACEBOOK_CAPABILITIES: ConnectorCapabilities = {
  supported: [
    'read_comments',
    'reply_comments',
    'read_dms',
    'send_dms',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
  publishLimits: {
    maxImages: 10,
    maxVideos: 1,
    maxTextLength: 63206,
    supportedMediaTypes: ['image', 'video', 'gif'],
  },
};
