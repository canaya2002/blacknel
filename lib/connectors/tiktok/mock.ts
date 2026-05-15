import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { TIKTOK_CAPABILITIES } from './capabilities';

export function buildTiktokConnector(): MockConnector {
  return new MockConnector('tiktok', TIKTOK_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
