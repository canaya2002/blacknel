import type { ConnectorCapabilities } from '../base';

export const GBP_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews', 'reply_reviews', 'read_insights', 'send_review_request'],
  notes: {
    send_review_request:
      'Google envía la solicitud a través del shortlink g.page de la ubicación; los review requests pasan por nuestra propia campaña + ese link.',
  },
};
