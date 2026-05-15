import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { YELP_CAPABILITIES } from './capabilities';

export function buildYelpConnector(): MockConnector {
  return new MockConnector('yelp', YELP_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
