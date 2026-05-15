import type { ConnectorCapabilities } from '../base';

export const LINKEDIN_CAPABILITIES: ConnectorCapabilities = {
  supported: ['publish_post', 'schedule_post', 'read_insights'],
  notes: {
    publish_post:
      'LinkedIn Marketing API publica como Company Page; perfiles personales no se soportan.',
  },
};
