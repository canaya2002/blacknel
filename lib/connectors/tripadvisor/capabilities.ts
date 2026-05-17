import type { ConnectorCapabilities } from '../base';

/**
 * TripAdvisor Content API (Phase 10 / Commit 38 — Enterprise
 * vertical: hoteles, restaurantes turísticos, atracciones).
 *
 * Reviews are read-only via the public Content API; reply +
 * dispute live in the Management API which requires a verified
 * business listing. We declare both — UI shows the action; Phase
 * 11 wires the Management API endpoint.
 */
export const TRIPADVISOR_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews', 'reply_reviews', 'review_dispute'],
  notes: {
    reply_reviews:
      'Requiere "Verified Owner" en TripAdvisor for Business. Phase 11 valida el verified flag por account.',
    review_dispute:
      'TripAdvisor permite dispute por contenido inapropiado. Endpoint disponible solo para owners verificados.',
  },
};
