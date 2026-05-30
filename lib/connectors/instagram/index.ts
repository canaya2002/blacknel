import { buildMetaConnector, type MetaConnector } from '../meta/connector';

import { INSTAGRAM_CAPABILITIES } from './capabilities';

export { INSTAGRAM_CAPABILITIES } from './capabilities';

/**
 * C46 — Instagram Business runs on the real Meta connector (Graph container flow
 * behind useRealMeta(), else the shared mock).
 */
export function buildInstagramConnector(): MetaConnector {
  return buildMetaConnector('instagram', INSTAGRAM_CAPABILITIES);
}
