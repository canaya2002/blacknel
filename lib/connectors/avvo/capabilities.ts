import type { ConnectorCapabilities } from '../base';

export const AVVO_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews'],
  notes: {
    read_reviews:
      'Avvo no tiene API pública. La importación dependerá de scraping respetando ToS — análisis legal pendiente; mientras tanto, el conector permanece declarable pero sin sync activo.',
  },
};
