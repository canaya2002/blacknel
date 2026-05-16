import type { ConnectorCapabilities } from '../base';

/**
 * YouTube Data API v3 limits as of 2026-Q1, sourced from
 * developers.google.com/youtube/v3/. Re-verify in Phase 11 — see
 * TODO.md#connector-publish-limits-2026.
 *
 * `publish_post` here covers Community posts (text + image) AND
 * uploading new videos via the Videos.insert endpoint. The composer
 * (Commit 19) routes by media kind: video → upload, image-only or
 * text-only → Community post.
 */
export const YOUTUBE_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_comments', 'reply_comments', 'read_insights', 'publish_post', 'schedule_post'],
  notes: {
    publish_post:
      'YouTube cubre Community posts (texto + imagen) Y subida de video (Videos.insert). El composer decide por kind del media. Community posts requieren canal con ≥500 suscriptores.',
  },
  publishLimits: {
    maxImages: 1,
    maxVideos: 1,
    maxTextLength: 5000,
    supportedMediaTypes: ['image', 'video'],
  },
};
