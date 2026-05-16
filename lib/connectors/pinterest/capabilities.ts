import type { ConnectorCapabilities } from '../base';

/**
 * Pinterest API publish limits as of 2026-Q1, sourced from
 * developers.pinterest.com/docs/api/v5/. Re-verify in Phase 11 —
 * see TODO.md#connector-publish-limits-2026.
 */
export const PINTEREST_CAPABILITIES: ConnectorCapabilities = {
  supported: ['publish_post', 'schedule_post'],
  notes: {
    publish_post:
      'Pinterest API publica Pins; cada pin requiere image_url o video_url y un board destino. Composer carga el board del account.metadata.',
  },
  publishLimits: {
    maxImages: 1,
    maxVideos: 1,
    maxTextLength: 500,
    supportedMediaTypes: ['image', 'video'],
    aspectRatios: ['2:3', '1:1'],
  },
};
