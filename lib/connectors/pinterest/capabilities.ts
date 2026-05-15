import type { ConnectorCapabilities } from '../base';

export const PINTEREST_CAPABILITIES: ConnectorCapabilities = {
  supported: ['publish_post', 'schedule_post'],
  notes: {
    publish_post:
      'Pinterest API publica Pins; cada pin requiere image_url o video_url y un board destino.',
  },
};
