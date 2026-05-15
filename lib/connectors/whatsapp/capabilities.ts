import type { ConnectorCapabilities } from '../base';

export const WHATSAPP_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_dms', 'send_dms', 'read_insights'],
  notes: {
    send_dms:
      'Fuera de la ventana de servicio (24h) solo se pueden enviar plantillas pre-aprobadas por Meta.',
  },
};
