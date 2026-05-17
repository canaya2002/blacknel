import type { ConnectorCapabilities } from '../base';

/**
 * Yelp Fusion API (Phase 10 / Commit 38 — Enterprise vertical:
 * restaurants, salones, servicios locales).
 *
 * Reviews are read-only via the Fusion API. `review_dispute` IS
 * supported on Yelp for Business (formal dispute process for
 * reseñas que violan policy) — surfaced here so UI can show the
 * action; Phase 11 wires the endpoint.
 */
export const YELP_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews', 'review_dispute'],
  notes: {
    read_reviews:
      'Yelp Fusion API: las reseñas se leen pero NO se responden desde aquí — el reply oficial requiere el dashboard de Yelp.',
    review_dispute:
      'Yelp permite dispute formal a reseñas que violan policy. Phase 11 conecta el endpoint real.',
  },
};
