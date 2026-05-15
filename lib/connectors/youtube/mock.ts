import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { YOUTUBE_CAPABILITIES } from './capabilities';

export function buildYoutubeConnector(): MockConnector {
  return new MockConnector('youtube', YOUTUBE_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
