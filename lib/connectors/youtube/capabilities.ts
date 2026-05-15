import type { ConnectorCapabilities } from '../base';

export const YOUTUBE_CAPABILITIES: ConnectorCapabilities = {
  supported: ['read_comments', 'reply_comments', 'read_insights'],
};
