import type { ConnectorCapabilities } from '../base';

export const BBB_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews'],
  notes: {
    read_reviews:
      'BBB no expone API pública. Las reseñas se importan manualmente vía CSV oficial — la pantalla de BBB pedirá el archivo cuando aterrice el flujo en la Fase 5.',
  },
};
