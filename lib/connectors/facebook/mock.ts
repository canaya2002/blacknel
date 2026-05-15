import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { FACEBOOK_CAPABILITIES } from './capabilities';

export function buildFacebookConnector(): MockConnector {
  return new MockConnector('facebook', FACEBOOK_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
