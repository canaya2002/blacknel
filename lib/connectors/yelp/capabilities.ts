import type { ConnectorCapabilities } from '../base';

/**
 * Yelp Fusion API is read-only end of story. `reply_reviews` is
 * intentionally absent — exposing a reply button anywhere in the UI
 * for Yelp would lead to "why does this not work" support tickets.
 */
export const YELP_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews'],
  notes: {
    read_reviews:
      'Yelp Fusion API es read-only: no se pueden responder, eliminar ni gestionar reseñas desde Blacknel. Para responder, abre el dashboard de Yelp manualmente.',
  },
};
