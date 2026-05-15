import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { INSTAGRAM_CAPABILITIES } from './capabilities';

export function buildInstagramConnector(): MockConnector {
  return new MockConnector('instagram', INSTAGRAM_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
