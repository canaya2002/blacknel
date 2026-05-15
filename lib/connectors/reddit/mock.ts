import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { REDDIT_CAPABILITIES } from './capabilities';

export function buildRedditConnector(): MockConnector {
  return new MockConnector('reddit', REDDIT_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
