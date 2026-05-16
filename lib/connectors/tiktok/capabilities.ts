import type { ConnectorCapabilities } from '../base';

/**
 * TikTok for Business publish limits as of 2026-Q1, sourced from
 * developers.tiktok.com/doc/content-posting-api. Re-verify in
 * Phase 11 — see TODO.md#connector-publish-limits-2026.
 */
export const TIKTOK_CAPABILITIES: ConnectorCapabilities = {
  supported: [
    'read_comments',
    'reply_comments',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
  notes: {
    publish_post:
      'TikTok Content Posting API solo acepta video. Imágenes y carouseles deben enviarse a través del flujo "photo mode" separado, no implementado.',
  },
  publishLimits: {
    maxImages: 0,
    maxVideos: 1,
    maxTextLength: 2200,
    supportedMediaTypes: ['video'],
  },
};
