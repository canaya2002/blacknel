import type { ConnectorCapabilities } from '../base';

/**
 * Trustpilot Business API (Phase 10 / Commit 38 — Enterprise
 * vertical: e-commerce, SaaS, servicios online).
 *
 * Read + reply both available via the Business API once OAuth
 * is set up. `send_review_request` ALSO available (Trustpilot
 * Invitation API) — surfaced for the C16-style request flow.
 */
export const TRUSTPILOT_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews', 'reply_reviews', 'send_review_request'],
  notes: {
    send_review_request:
      'Trustpilot Invitation API: 50/day cap on free tier, unlimited on Business Plus.',
  },
};
