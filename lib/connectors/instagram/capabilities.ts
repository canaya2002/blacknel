import type { ConnectorCapabilities } from '../base';

/**
 * Instagram Graph API publish limits as of 2026-Q1, sourced from
 * developers.facebook.com/docs/instagram-api/publishing. Re-verify
 * in Phase 11 — see TODO.md#connector-publish-limits-2026.
 */
export const INSTAGRAM_CAPABILITIES: ConnectorCapabilities = {
  supported: [
    'read_comments',
    'reply_comments',
    'read_dms',
    'send_dms',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
  notes: {
    read_dms:
      'La Messenger API expone DMs solo si la cuenta está vinculada a una Página de FB; ventana de 7 días.',
    send_dms:
      'Solo se puede responder dentro de las 24h posteriores al último mensaje del usuario.',
    publish_post:
      'Carousel posts admiten hasta 10 elementos (mezcla imagen / video). Reels usan endpoint separado.',
  },
  publishLimits: {
    maxImages: 10,
    maxVideos: 1,
    maxTextLength: 2200,
    supportedMediaTypes: ['image', 'video'],
    aspectRatios: ['1:1', '4:5', '1.91:1'],
  },
};
