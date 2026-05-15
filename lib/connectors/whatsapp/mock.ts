import { MockConnector } from '../base';
import { env } from '@/lib/env';

import { WHATSAPP_CAPABILITIES } from './capabilities';

export function buildWhatsappConnector(): MockConnector {
  return new MockConnector('whatsapp', WHATSAPP_CAPABILITIES, {
    emitErrors: env.BLACKNEL_MOCK_ERRORS,
  });
}
