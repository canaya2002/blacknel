import type { ConnectorCapabilities } from '../base';

/**
 * Google Business Profile API limits as of 2026-Q1, sourced from
 * developers.google.com/my-business/. Re-verify in Phase 11 — see
 * TODO.md#connector-publish-limits-2026.
 *
 * GBP "posts" (called "local posts" in the API) are distinct from
 * the review pipeline — different endpoint, different capability,
 * different lifecycle. The capability list keeps them separated:
 *
 *   - `read_reviews` / `reply_reviews` → GMB reviews API
 *   - `publish_post` / `schedule_post`   → GMB local-posts API
 *
 * The composer routes by capability, not by platform alone.
 */
export const GBP_CAPABILITIES: ConnectorCapabilities = {
  supported: [
    'read_reviews',
    'reply_reviews',
    'read_insights',
    'send_review_request',
    'publish_post',
    'schedule_post',
  ],
  notes: {
    send_review_request:
      'Google envía la solicitud a través del shortlink g.page de la ubicación; los review requests pasan por nuestra propia campaña + ese link.',
    publish_post:
      'GBP "local posts" — distintos de las reviews. Tipos: STANDARD, EVENT, OFFER, ALERT. Composer expone solo STANDARD en Fase 6; eventos / ofertas vienen en Fase 10.',
  },
  publishLimits: {
    maxImages: 10,
    maxVideos: 1,
    maxTextLength: 1500,
    supportedMediaTypes: ['image', 'video'],
  },
};
