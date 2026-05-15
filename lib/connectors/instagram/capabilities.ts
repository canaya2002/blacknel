import type { ConnectorCapabilities } from '../base';

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
  },
};
