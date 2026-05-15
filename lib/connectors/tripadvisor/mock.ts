import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { TRIPADVISOR_CAPABILITIES } from './capabilities';

export function buildTripadvisorConnector(): MockConnector {
  return new MockConnector('tripadvisor', TRIPADVISOR_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
