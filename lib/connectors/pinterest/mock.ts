import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { PINTEREST_CAPABILITIES } from './capabilities';

export function buildPinterestConnector(): MockConnector {
  return new MockConnector('pinterest', PINTEREST_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
