import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { AVVO_CAPABILITIES } from './capabilities';

export function buildAvvoConnector(): MockConnector {
  return new MockConnector('avvo', AVVO_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
