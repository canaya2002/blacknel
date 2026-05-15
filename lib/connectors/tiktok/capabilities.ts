import type { ConnectorCapabilities } from '../base';

export const TIKTOK_CAPABILITIES: ConnectorCapabilities = {
  supported: [
    'read_comments',
    'reply_comments',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
};
