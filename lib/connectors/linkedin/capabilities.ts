import type { ConnectorCapabilities } from '../base';

/**
 * LinkedIn Marketing API publish limits as of 2026-Q1, sourced
 * from learn.microsoft.com/en-us/linkedin/marketing/integrations/.
 * Re-verify in Phase 11 — see
 * TODO.md#connector-publish-limits-2026.
 */
export const LINKEDIN_CAPABILITIES: ConnectorCapabilities = {
  supported: ['publish_post', 'schedule_post', 'read_insights'],
  notes: {
    publish_post:
      'LinkedIn Marketing API publica como Company Page; perfiles personales no se soportan.',
  },
  publishLimits: {
    maxImages: 9,
    maxVideos: 1,
    maxTextLength: 3000,
    supportedMediaTypes: ['image', 'video', 'pdf'],
  },
};
