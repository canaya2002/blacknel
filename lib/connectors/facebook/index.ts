import { buildMetaConnector, type MetaConnector } from '../meta/connector';

import { FACEBOOK_CAPABILITIES } from './capabilities';

export { FACEBOOK_CAPABILITIES } from './capabilities';

/**
 * C46 — Facebook Pages run on the real Meta connector (Graph API behind
 * useRealMeta(), else the shared mock). `buildFacebookConnector` keeps the same
 * name/registry slot; only the implementation graduated from pure-mock.
 */
export function buildFacebookConnector(): MetaConnector {
  return buildMetaConnector('facebook', FACEBOOK_CAPABILITIES);
}
