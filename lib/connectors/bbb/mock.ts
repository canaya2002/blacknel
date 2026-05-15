import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { BBB_CAPABILITIES } from './capabilities';

export function buildBbbConnector(): MockConnector {
  return new MockConnector('bbb', BBB_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
