import type { ConnectorCapabilities } from '../base';

/**
 * BBB (Phase 10 / Commit 38 — Enterprise vertical: resolución
 * de quejas para negocios con presencia EE.UU.).
 *
 * BBB es complaint-resolution, NO review-based. `read_reviews`
 * declared as the read surface (we store complaints in the
 * `reviews` table per D-38-2 (a) — `rating=NULL` +
 * `platform_specific` carries the complaint state). The
 * `complaint_response` capability is the actionable one — manager
 * resolves / responds via Blacknel.
 *
 * Phase 11: BBB does not expose a public OAuth API. Real
 * integration uses CSV bulk import OR per-account API keys
 * obtained directly from BBB Business Profile. Tracking:
 * TODO.md#enterprise-networks-bbb-api-rollout.
 */
export const BBB_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_reviews', 'complaint_response'],
  notes: {
    read_reviews:
      'BBB no es review-based. Las "reviews" en Blacknel son complaint cases con rating=NULL y lifecycle en platform_specific.',
    complaint_response:
      'BBB permite responder a complaints con resolution_summary. La transición pending → resolved es la conversión clave.',
  },
};
