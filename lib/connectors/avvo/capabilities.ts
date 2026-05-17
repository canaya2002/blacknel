import type { ConnectorCapabilities } from '../base';

/**
 * Avvo (Phase 10 / Commit 38 — Enterprise vertical: servicios
 * legales, abogados, consultoría legal).
 *
 * Read + reply both declared. Reply requires "Claimed Profile"
 * en Avvo Pro. Mock-supported today; Phase 11 evaluates API
 * availability (Avvo no expone OAuth pública). Tracking:
 * TODO.md#enterprise-networks-avvo-api-rollout.
 */
export const AVVO_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews', 'reply_reviews'],
  notes: {
    read_reviews:
      'Avvo soporta lectura para perfiles públicos. Phase 11 valida si el endpoint queda disponible o requiere scraping con análisis legal previo.',
    reply_reviews:
      'Requires "Claimed Profile" + Avvo Pro. Mock-supported; Phase 11 wire if/when API access is granted.',
  },
};
