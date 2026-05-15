import type { ConnectorCapabilities } from '../base';

export const X_CAPABILITIES: ConnectorCapabilities = {
  supported: ['publish_post', 'schedule_post', 'read_dms', 'send_dms', 'read_mentions'],
  notes: {
    read_dms:
      'X API v2 expone DMs solo en planes Basic+; cuentas Free están limitadas a lectura limitada.',
  },
};
