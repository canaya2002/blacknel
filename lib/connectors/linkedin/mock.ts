import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { LINKEDIN_CAPABILITIES } from './capabilities';

export function buildLinkedinConnector(): MockConnector {
  return new MockConnector('linkedin', LINKEDIN_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
