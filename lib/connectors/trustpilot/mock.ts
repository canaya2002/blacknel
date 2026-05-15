import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { TRUSTPILOT_CAPABILITIES } from './capabilities';

export function buildTrustpilotConnector(): MockConnector {
  return new MockConnector('trustpilot', TRUSTPILOT_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
