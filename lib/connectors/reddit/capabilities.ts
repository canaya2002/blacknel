import type { ConnectorCapabilities } from '../base';

export const REDDIT_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_mentions', 'listening_source'],
  notes: {
    listening_source:
      'Reddit alimenta el módulo de Listening con subreddits y queries booleanas — no se trata de una cuenta para responder, sino de una fuente de monitoreo.',
  },
};
