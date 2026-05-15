import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { X_CAPABILITIES } from './capabilities';

export function buildXConnector(): MockConnector {
  return new MockConnector('x', X_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
