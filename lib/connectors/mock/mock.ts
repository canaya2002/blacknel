import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { MOCK_CAPABILITIES } from './capabilities';

export function buildMockConnector(): MockConnector {
  return new MockConnector('mock', MOCK_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
