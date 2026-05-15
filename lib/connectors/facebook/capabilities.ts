import type { ConnectorCapabilities } from '../base';

export const FACEBOOK_CAPABILITIES: ConnectorCapabilities = {
  supported: [
    'read_comments',
    'reply_comments',
    'read_dms',
    'send_dms',
    'publish_post',
    'schedule_post',
    'read_insights',
  ],
};
