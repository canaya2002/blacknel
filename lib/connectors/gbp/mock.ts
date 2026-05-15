import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { GBP_CAPABILITIES } from './capabilities';

export function buildGbpConnector(): MockConnector {
  return new MockConnector('gbp', GBP_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
